using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// Attestation contract (Forseti / Ork.Forseti.Sdk).
//
// WHAT AN ATTESTATION IS
//
// A statement the network signs with the realm's key, after this contract has agreed that THIS
// signer may make THIS statement. Your server can verify it for ever after and can never forge it.
// A fact that used to be "a row says so" becomes "the network signed it, and the signature still
// verifies" - which holds even if the app server or its database is compromised.
//
//     Issuer  attests  Claim  about  Subject  [regarding Object]  [= Value]  [until Expiry]
//
//     member-of     Alice added Bob to her close-friends group
//     assigned      a team lead put Carol on case 42 as reviewer
//     consented     Dave agrees to data-sharing policy v3
//     verified      a compliance officer confirms Erin passed identity checks
//     approved      a manager signed off expense report 9912
//
// HOW IT IS SIGNED
//
// The statement is itself a policy: a small signed structure whose parameters carry the claim. It is
// signed with an ordinary `Policy:1` request, authorised by ONE rule the realm's admins sign once
// (IMPLICIT approval, PRIVATE execution). After that nobody approves an individual attestation: the
// signer's own credential is the whole check. So this contract is almost entirely about what to
// REFUSE, and each rule is deliberately narrow: it names the claim types it may sign and who may
// issue them.
//
// WHO MAY ISSUE (the rule's IssuerMode)
//
//   self   You attest something about YOURSELF: Subject must be the signer.
//          Consent, acknowledgement, a declaration, accepting an invitation.
//   owner  You attest something about a thing YOU OWN: Owner must be the signer, Subject somebody else.
//          Adding a friend to your group, sharing your document, naming your delegate.
//   role   You hold a role that lets you attest about ANYONE: the signer must hold IssuerRole.
//          Assigning a case, confirming a verification, approving on behalf of the organisation.
//
// In every mode the signer must be the person the statement names as Issuer, so an attestation can
// never name somebody else as the one who made it.
//
// WHAT IT DOES NOT DO
//
//   - It does not prove the Subject agreed, unless the Subject is the Issuer (self mode).
//   - It does not prove WHEN. The contract reads no clock. An Expiry is part of the signed statement
//     and your server enforces it on read; for a time the network itself vouches for, use the
//     provenance pattern (reference-apps/attested-provenance-registry).
//   - It is not revoked by the network. Withdrawing one is deleting the stored signature, which your
//     server controls (see the template README, "Revocation").
//   - A signed attestation authorises no network operation. Presenting one as a request is refused.
//
// IL VETTER: no lambdas or LINQ (they emit ldftn), no static field initialisers (they become a
// static constructor), no clock reads. Each of those compiles locally and is rejected by the ork.
public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true, Description = "Client the attestations are for")]
    public string Resource { get; set; }

    [PolicyParam(Required = true, Description = "Claim types this rule may sign, comma-separated, e.g. member-of,assigned")]
    public string Claims { get; set; }

    [PolicyParam(Default = "self", AllowedValues = new[] { "self", "owner", "role" },
        Description = "self = about yourself; owner = about something you own; role = you hold IssuerRole")]
    public string IssuerMode { get; set; } = "self";

    [PolicyParam(Default = "", Description = "Client role an issuer must hold when IssuerMode is role")]
    public string IssuerRole { get; set; } = "";

    [PolicyParam(Default = "no", AllowedValues = new[] { "no", "yes" },
        Description = "Whether an attestation under this rule may carry an expiry")]
    public string AllowExpiry { get; set; } = "no";

    // "Sign this policy". The rule presented with the request is what authorises it.
    private const string PolicySignOp = "Policy:1";

    // What gets signed. A custom model id, because the ork only signs a policy naming a model it
    // recognises, and because no real request carries it. Must match ATTESTATION_MODEL in attestation.ts.
    private const string AttestationModel = "BasicCustom<Attestation>:BasicCustom<1>";

    private const int MaxClaimLength = 64;
    private const int MaxFieldLength = 256;

    // ExecutorContext carries no RequestId, so what ValidateExecutor needs is captured in
    // ValidateData, which runs first. Instance fields: a static initialiser would be refused.
    private string _requestId;
    private string _issuer;

    public PolicyDecision ValidateData(DataContext ctx)
    {
        _requestId = ctx.RequestId;
        _issuer = null;

        // An attestation, not a licence.
        if (ctx.RequestId == AttestationModel)
            return PolicyDecision.Deny("an attestation authorises no network operation");

        if (ctx.RequestId != PolicySignOp)
            return PolicyDecision.Deny("this contract only signs attestations");

        // The rule must be the kind this contract was written for. EXPLICIT would put a quorum in
        // front of something designed to need none; PUBLIC would drop the signer's credential, and
        // then anyone could sign anything this contract allows.
        if (ctx.Policy.ApprovalType != ApprovalType.IMPLICIT)
            return PolicyDecision.Deny("the signing rule must be IMPLICIT");
        if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE)
            return PolicyDecision.Deny("the signing rule must require the signer's own credential (PRIVATE)");

        if (Claims == null || Claims.Length == 0)
            return PolicyDecision.Deny("the signing rule names no claim types");
        if (IssuerMode == "role" && (IssuerRole == null || IssuerRole.Length == 0))
            return PolicyDecision.Deny("IssuerMode is role but the rule names no IssuerRole");

        var models = new List<string>();
        string claim = null, issuer = null, obj = null, owner = null, resource = null, subject = null, value = null;
        string approval = null, execution = null;
        bool hasExpiry = false;
        try
        {
            // Draft[0] is the policy being signed, wrapped once; its first value is the bytes the
            // network signs: [version, contractId, modelIds, keyId, approval, execution, params, expiry?].
            var body = new ReadOnlyMemory<byte>(ctx.Data).GetValue(0).GetValue(0);

            var modelSection = body.GetValue(2);
            for (int i = 0; modelSection.TryGetValue(i, out var id); i++)
                models.Add(Encoding.UTF8.GetString(id.Span));

            approval  = Encoding.UTF8.GetString(body.GetValue(4).Span);
            execution = Encoding.UTF8.GetString(body.GetValue(5).Span);

            // Each parameter is [name, type, value].
            var parameters = body.GetValue(6);
            for (int i = 0; parameters.TryGetValue(i, out var entry); i++)
            {
                var name = Encoding.UTF8.GetString(entry.GetValue(0).Span);
                var type = Encoding.UTF8.GetString(entry.GetValue(1).Span);
                var text = Encoding.UTF8.GetString(entry.GetValue(2).Span);

                if (type != "str")
                    return PolicyDecision.Deny("every field of an attestation is a string");
                if (text.Length == 0 || text.Length > MaxFieldLength)
                    return PolicyDecision.Deny("an attestation field is empty or too long: " + name);

                // Only these seven, each at most once. An unknown or repeated name is refused rather
                // than ignored: the statement is what is signed, and nothing may ride along inside it.
                if (name == "Claim")         { if (claim != null)    return Repeated(name); claim = text; }
                else if (name == "Issuer")   { if (issuer != null)   return Repeated(name); issuer = text; }
                else if (name == "Object")   { if (obj != null)      return Repeated(name); obj = text; }
                else if (name == "Owner")    { if (owner != null)    return Repeated(name); owner = text; }
                else if (name == "Resource") { if (resource != null) return Repeated(name); resource = text; }
                else if (name == "Subject")  { if (subject != null)  return Repeated(name); subject = text; }
                else if (name == "Value")    { if (value != null)    return Repeated(name); value = text; }
                else return PolicyDecision.Deny("an attestation has no field named " + name);
            }

            // Seven fields is a policy without an expiry; an eighth is one.
            if (body.TryGetValue(7, out var expiry) && expiry.Length > 0)
            {
                if (expiry.Length != 8) return PolicyDecision.Deny("an expiry must be 8 bytes");
                hasExpiry = true;
            }
        }
        catch
        {
            return PolicyDecision.Deny("the policy being signed could not be read");
        }

        // Exactly one model, and it is the attestation. "any" would authorise every request the
        // realm's key can sign; Policy:1 would be a new signing rule, minted with no admin involved.
        if (models.Count != 1 || models[0] != AttestationModel)
            return PolicyDecision.Deny("this rule signs attestations only");

        // Fixed, so there is one way to write a given statement and the bytes are canonical.
        if (approval != "IMPLICIT" || execution != "PRIVATE")
            return PolicyDecision.Deny("an attestation is written as IMPLICIT and PRIVATE");

        if (claim == null || issuer == null || resource == null || subject == null)
            return PolicyDecision.Deny("an attestation names Claim, Issuer, Subject and Resource");

        if (resource != Resource)
            return PolicyDecision.Deny("an attestation must be for this rule's client");

        // A rule signs the claim types it was minted for and no others. Without this, a rule made
        // for "member-of" could be used to sign "verified".
        if (claim.Length > MaxClaimLength || claim.IndexOf(',') >= 0 || !Listed(Claims, claim))
            return PolicyDecision.Deny("this rule does not sign claims of type " + claim);

        if (hasExpiry && AllowExpiry != "yes")
            return PolicyDecision.Deny("attestations under this rule must not carry an expiry");

        if (IssuerMode == "self")
        {
            // About yourself, by yourself. This is the only mode in which the Subject has agreed.
            if (subject != issuer)
                return PolicyDecision.Deny("under a self rule you can only attest about yourself");
            if (owner != null)
                return PolicyDecision.Deny("a self attestation has no Owner");
        }
        else if (IssuerMode == "owner")
        {
            // About a thing you own. The heart of every personal group, list and share.
            if (owner == null)
                return PolicyDecision.Deny("under an owner rule an attestation names its Owner");
            if (owner != issuer)
                return PolicyDecision.Deny("only the owner can attest about what they own");
            if (subject == issuer)
                return PolicyDecision.Deny("under an owner rule the Subject is somebody else");
        }

        _issuer = issuer;
        return PolicyDecision.Allow();
    }

    private PolicyDecision Repeated(string name)
    {
        return PolicyDecision.Deny("an attestation names " + name + " more than once");
    }

    // Whether `item` is one of the comma-separated entries of `list`, exactly. A loop, not Split and
    // not LINQ: nothing here may emit a delegate.
    private bool Listed(string list, string item)
    {
        int start = 0;
        while (start <= list.Length)
        {
            int comma = list.IndexOf(',', start);
            int end = comma < 0 ? list.Length : comma;
            if (end - start == item.Length && string.CompareOrdinal(list, start, item, 0, item.Length) == 0)
                return true;
            if (comma < 0) break;
            start = comma + 1;
        }
        return false;
    }

    // Never reached under the IMPLICIT rule this contract requires. Refuse rather than leave it to
    // a default, so a rule minted the wrong way cannot find an approval path here.
    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        return PolicyDecision.Deny("attestations are signed on the signer's own credential, not by approval");
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        if (_requestId != PolicySignOp || _issuer == null)
            return PolicyDecision.Deny("unsupported operation");

        // The ork has already verified this credential against the realm key and refused it if it
        // was issued for another key. What is left is whether this person is who the statement says
        // made it - and, in role mode, whether they are allowed to.
        var signer = new DokenDto(ctx.Doken);

        var decision = Decision
            .RequireNotExpired(signer)
            .Require(signer.UserId != null && signer.UserId == _issuer,
                     "the signer is not the Issuer this attestation names");

        if (IssuerMode == "role")
            decision = decision.RequireAnyRole(signer, Resource, new[] { IssuerRole });

        return decision;
    }
}
