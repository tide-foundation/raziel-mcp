// Forseti local compile harness — SHAPE-ONLY stubs.
//
// PURPOSE: catch shape errors in your contract before deploying it. Contracts are compiled by the
// ORK at request time, so a typo or a wrong API assumption surfaces as `VmHost.CompileFailed`
// AFTER an operator approval has been spent in the enclave.
//
// BEHAVIOUR IS DELIBERATELY ABSENT. Every method returns a fixed value. A passing build says the
// contract COMPILES, never that it DECIDES correctly.
//
// ---------------------------------------------------------------------------------------------
// FIDELITY: these shapes are derived from the two WORKING reference contracts vendored in the
// pack, not from prose:
//   sources/example-app-forseti-crypto-quickstart/template-ts-app/lib/forsetiContract.ts
//   sources/example-app-tidecloak-test-cases/test-app/src/lib/forsetiDecryptionContract.ts
// Both are deployed, working contracts. `check.sh --self-test` compiles both against these stubs,
// so drift between the stubs and the real SDK shows up as a failure here rather than as a false
// PASS on your own contract.
//
// HISTORY, because this file has now been wrong in both directions:
//   * An early revision typed `ctx.Data` as `byte[]` and gave `PolicyDecision` a public
//     `IsAllowed`. The `IsAllowed` part was simply wrong.
//   * The 2026-08-11 "correction" then pinned Data to `ReadOnlyMemory<byte>` on the strength of the
//     vendored quickstart contracts. That was an OVER-correction: those contracts compile under
//     either typing, so they were never evidence -- while two ORK-proven contracts require a
//     reference type. It made the harness reject a contract with real threshold signatures on
//     record (reported independently by sashlings L-10 and vialproof L-02).
// The typing is therefore treated as UNRESOLVED and compiled BOTH ways. Do not "simplify" this
// back to one typing without an ORK error message that settles it.
// ---------------------------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Linq;

namespace Ork.Shared.Models.Contracts
{
    // Policy metadata visible to the contract via `ctx.Policy`. VERIFIED members: ExecutionType,
    // ApprovalType (both read by the reference contracts). Namespace placement is ASSUMED — what
    // matters for a compile check is that it resolves with the six required usings present.
    public enum ApprovalType { EXPLICIT = 0, IMPLICIT = 1 }
    public enum ExecutionType { PRIVATE = 0, PUBLIC = 1 }

    public class Policy
    {
        public ExecutionType ExecutionType => ExecutionType.PRIVATE;
        public ApprovalType ApprovalType => ApprovalType.EXPLICIT;
        public string ContractId => string.Empty;
        public IReadOnlyList<string> ModelIds => Array.Empty<string>();
    }

    /// TideMemory accessors over the serialized request payload.
    ///
    /// `ctx.Data` is a `ReadOnlyMemory<byte>` holding a NESTED TideMemory structure — NOT a
    /// collection of objects, and NOT a flat `byte[]`. You walk it with these:
    ///
    ///     ReadOnlyMemory&lt;byte&gt; data = ctx.Data;
    ///     var inner = data.GetValue(1);
    ///     for (int i = 2; inner.TryGetValue(i, out var tag); i++) { ... }
    ///
    /// Read a leaf as text with `Encoding.UTF8.GetString(tag.Span)`.
    public static class TideMemoryExtensions
    {
        /// Value at `index`. Throws in the real SDK when the index is absent — use TryGetValue to probe.
        public static ReadOnlyMemory<byte> GetValue(this ReadOnlyMemory<byte> data, int index)
            => ReadOnlyMemory<byte>.Empty;

        public static bool TryGetValue(this ReadOnlyMemory<byte> data, int index, out ReadOnlyMemory<byte> value)
        {
            value = ReadOnlyMemory<byte>.Empty;
            return false;
        }
    }
}

namespace Cryptide.Tools
{
    /// The ONLY sanctioned clock inside a contract. IL vetting runs with BlockNonDeterminism = true
    /// and rejects direct `DateTime.Now`/`UtcNow`/`Guid.NewGuid` call sites; `Utils` is a
    /// pre-compiled method in a separate assembly, so calling it passes vetting.
    public static class Utils
    {
        public static long GetEpochSeconds() => 0;
        public static byte[] Hash(byte[] data) => Array.Empty<byte>();
        public static string ToHexString(byte[] data) => string.Empty;
        public static byte[] FromHexString(string hex) => Array.Empty<byte>();
    }
}

namespace Ork.Forseti.Sdk
{
    using Ork.Shared.Models.Contracts;

    // ---------------------------------------------------------------------
    // Decision result
    // ---------------------------------------------------------------------

    public class PolicyDecision
    {
        // NOTE: no public `IsAllowed` / `Reason`. The reference contracts never inspect a decision —
        // they RETURN one. `Decision.RequireX(...)` chains return a decision directly, so there is
        // nothing to interrogate. Exposing an inspection surface here would let a contract compile
        // against a member the real SDK does not have (the original error that prompted this fix).
        private PolicyDecision() { }

        public static PolicyDecision Allow() => new PolicyDecision();
        public static PolicyDecision Deny(string reason) => new PolicyDecision();

        // PolicyDecision.Approve() deliberately does NOT exist — using it must fail locally.
    }

    // ---------------------------------------------------------------------
    // Contexts — DISJOINT BY DESIGN.
    //
    // `ctx.Data` exists ONLY on DataContext. ValidateExecutor sees the doken, not the payload, so
    // anything derived from the payload must be captured into an INSTANCE FIELD in ValidateData
    // and read later. Both reference contracts do exactly this (`isEncryptionRequest`, `DataTags`,
    // `ApproverSuccessfulRole`). Writing `ctx.Data` in ValidateExecutor compiles in an editor and
    // fails ON THE ORK with CS1061, after an approval has been spent.
    // ---------------------------------------------------------------------

    public class DataContext
    {
        // ---------------------------------------------------------------------------------------
        // `ctx.Data`'s REAL type is NOT settled, so this harness compiles your contract against
        // BOTH candidates and requires it to pass under both. See README "The ctx.Data question".
        //
        //   FORSETI_DATA_ROM defined  -> ReadOnlyMemory<byte>   (the vendored quickstart style)
        //   otherwise                 -> byte[]                 (the ORK-signature-backed style)
        //
        // Why both, rather than picking one: the asymmetry means only ONE direction is evidence.
        // `byte[]` converts implicitly to `ReadOnlyMemory<byte>`, so a ROM-style contract compiles
        // under EITHER typing and proves nothing. The reverse does not convert, so a contract doing
        // `byte[] d = ctx.Data;` or `ctx.Data == null` compiles ONLY if Data is a reference type --
        // and two such contracts are ORK-proven (music-license OriginAttestation, whose contractId
        // matches its signed policy byte for byte, and keylessh sshPolicy). Measured with the real
        // compiler, 2026-08-20.
        // ---------------------------------------------------------------------------------------
        /// A nested TideMemory structure, not a flat buffer. See TideMemoryExtensions.
#if FORSETI_DATA_ROM
        public ReadOnlyMemory<byte> Data => ReadOnlyMemory<byte>.Empty;
        public ReadOnlyMemory<byte> DynamicData => ReadOnlyMemory<byte>.Empty;
#else
        public byte[] Data => Array.Empty<byte>();
        public byte[] DynamicData => Array.Empty<byte>();
#endif

        /// e.g. "PolicyEnabledEncryption:1" / "PolicyEnabledDecryption:1" — how a contract tells
        /// encrypt from decrypt, which matters because their payload layouts differ.
        public string RequestId => string.Empty;

        /// The policy governing this request. Reference contracts assert
        /// `ctx.Policy.ExecutionType` / `ctx.Policy.ApprovalType`.
        public Policy Policy => new Policy();
    }

    public class ApproversContext
    {
        /// `Dokens`, not `Approvers`. Wrap with `DokenDto.WrapAll(ctx.Dokens)`.
        public List<byte[]> Dokens => new List<byte[]>();
        public string RequestId => string.Empty;
    }

    public class ExecutorContext
    {
        /// `Doken`, not `Executor`. There is deliberately NO `Data` here.
        public byte[] Doken => Array.Empty<byte>();
        public string RequestId => string.Empty;
    }

    // ---------------------------------------------------------------------
    // Contract entry point
    //
    // Only ValidateData is required. The forseti-crypto-quickstart reference implements
    // ValidateData + ValidateExecutor and OMITS ValidateApprovers entirely, so declaring all three
    // as required members would fail correct contracts. Default implementations mirror that.
    //
    // TRADE-OFF worth knowing: because these are optional, a MISSPELLED override (ValidateExecuter)
    // compiles and silently never runs. The parity-test template pins method presence by name —
    // see templates/forseti-parity-tests/.
    // ---------------------------------------------------------------------

    public interface IAccessPolicy
    {
        PolicyDecision ValidateData(DataContext ctx);
        PolicyDecision ValidateApprovers(ApproversContext ctx) => PolicyDecision.Allow();
        PolicyDecision ValidateExecutor(ExecutorContext ctx) => PolicyDecision.Allow();
    }

    // ---------------------------------------------------------------------
    // DokenDto — token wrapper
    //
    // UserId returns the VUID. A doken carries NO OIDC `sub`, so a contract can only ever enforce
    // the vuid (AP-66).
    // ---------------------------------------------------------------------

    public class DokenDto
    {
        public DokenDto(byte[] doken) { }
        public DokenDto(ReadOnlyMemory<byte> doken) { }

        public string UserId => string.Empty;      // == Payload.Vuid
        public string Audience => string.Empty;
        public long Expiry => 0;
        public bool IsExpired => false;
        public bool IsNull => false;

        /// 1-arg form = REALM role (used by the Cola reference). 2-arg form = client role.
        public bool HasRole(string realmRole) => false;
        public bool HasRole(string resource, string role) => false;
        public bool HasAnyRole(string resource, params string[] roles) => false;
        public bool HasAllRoles(string resource, params string[] roles) => false;

        public static List<DokenDto> WrapAll(List<byte[]> dokens) =>
            dokens?.Select(d => new DokenDto(d)).ToList() ?? new List<DokenDto>();

        public static List<DokenDto> WrapAll(IEnumerable<byte[]> dokens) =>
            dokens?.Select(d => new DokenDto(d)).ToList() ?? new List<DokenDto>();
    }

    // ---------------------------------------------------------------------
    // Decision builder
    //
    // `Decision.X(...)` returns a chainable builder that converts implicitly to PolicyDecision, so
    //   return Decision.RequireNotExpired(x).RequireRole(x, role);
    // typechecks in a method returning PolicyDecision. There is no result to inspect.
    //
    // C# forbids a static and an instance method with the same signature on one type, hence the
    // split. Keep both surfaces IDENTICAL — a method on one and not the other fails depending on
    // where in the chain it appears.
    // ---------------------------------------------------------------------

    public class DecisionBuilder
    {
        public static implicit operator PolicyDecision(DecisionBuilder b) => PolicyDecision.Allow();

        public DecisionBuilder RequireRole(DokenDto doken, string resource, string role) => this;
        public DecisionBuilder RequireRole(DokenDto doken, string realmRole) => this;
        public DecisionBuilder RequireAnyRole(DokenDto doken, string resource, params string[] roles) => this;
        public DecisionBuilder RequireAllRoles(DokenDto doken, string resource, params string[] roles) => this;
        public DecisionBuilder ForbidRole(DokenDto doken, string resource, string role) => this;

        public DecisionBuilder RequireMinWithRole(List<DokenDto> approvers, int min, string resource, string role) => this;
        public DecisionBuilder RequireAnyWithRole(List<DokenDto> approvers, string resource, string role) => this;
        public DecisionBuilder ForbidSelfApproval(string requestorId, List<DokenDto> approvers) => this;
        public DecisionBuilder RequireDistinctOrgs(List<DokenDto> approvers, int count) => this;

        public DecisionBuilder RequireWeekday() => this;
        public DecisionBuilder RequireBusinessHours() => this;
        public DecisionBuilder RequireHourBetween(int startHour, int endHour) => this;
        public DecisionBuilder ForbidHourBetween(int startHour, int endHour) => this;
        public DecisionBuilder RequireDayOfWeek(DayOfWeek day) => this;

        public DecisionBuilder RequireNotExpired(DokenDto doken) => this;
        public DecisionBuilder RequireFromAudience(DokenDto doken, string audience) => this;
        public DecisionBuilder RequireUserId(DokenDto doken, string userId) => this;

        public DecisionBuilder RequireCountry(string country, params string[] allowed) => this;
        public DecisionBuilder ForbidCountry(string country, params string[] blocked) => this;

        public DecisionBuilder Require(bool condition, string denyReason) => this;
        public DecisionBuilder Forbid(bool condition, string denyReason) => this;
    }

    public static class Decision
    {
        private static DecisionBuilder B() => new DecisionBuilder();

        public static DecisionBuilder RequireRole(DokenDto doken, string resource, string role) => B();
        public static DecisionBuilder RequireRole(DokenDto doken, string realmRole) => B();
        public static DecisionBuilder RequireAnyRole(DokenDto doken, string resource, params string[] roles) => B();
        public static DecisionBuilder RequireAllRoles(DokenDto doken, string resource, params string[] roles) => B();
        public static DecisionBuilder ForbidRole(DokenDto doken, string resource, string role) => B();

        public static DecisionBuilder RequireMinWithRole(List<DokenDto> approvers, int min, string resource, string role) => B();
        public static DecisionBuilder RequireAnyWithRole(List<DokenDto> approvers, string resource, string role) => B();
        public static DecisionBuilder ForbidSelfApproval(string requestorId, List<DokenDto> approvers) => B();
        public static DecisionBuilder RequireDistinctOrgs(List<DokenDto> approvers, int count) => B();

        public static DecisionBuilder RequireWeekday() => B();
        public static DecisionBuilder RequireBusinessHours() => B();
        public static DecisionBuilder RequireHourBetween(int startHour, int endHour) => B();
        public static DecisionBuilder ForbidHourBetween(int startHour, int endHour) => B();
        public static DecisionBuilder RequireDayOfWeek(DayOfWeek day) => B();

        public static DecisionBuilder RequireNotExpired(DokenDto doken) => B();
        public static DecisionBuilder RequireFromAudience(DokenDto doken, string audience) => B();
        public static DecisionBuilder RequireUserId(DokenDto doken, string userId) => B();

        public static DecisionBuilder RequireCountry(string country, params string[] allowed) => B();
        public static DecisionBuilder ForbidCountry(string country, params string[] blocked) => B();

        public static DecisionBuilder Require(bool condition, string denyReason) => B();
        public static DecisionBuilder Forbid(bool condition, string denyReason) => B();
    }

    // ---------------------------------------------------------------------
    // ForsetiSdk runtime
    // ---------------------------------------------------------------------

    public static class ForsetiSdk
    {
        public static object Claim(string key) => null;   // costs 5 gas
        public static void Log(string message) { }        // costs 25 gas
        public static int GasUsed => 0;
        public static int GasLimit => 50_000;
    }

    // ---------------------------------------------------------------------
    // [PolicyParam] — bound from policy config
    // ---------------------------------------------------------------------

    [AttributeUsage(AttributeTargets.Property)]
    public class PolicyParamAttribute : Attribute
    {
        public bool Required { get; set; }
        public object Default { get; set; }
        public object Min { get; set; }
        public object Max { get; set; }
        public string[] AllowedValues { get; set; }
        public string Description { get; set; }
    }
}
