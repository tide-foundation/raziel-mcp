// Forseti local compile harness — SHAPE-ONLY stubs.
//
// PURPOSE: catch shape errors in your contract before deploying it. Contracts are compiled by the
// ORK at request time, so a typo or a wrong context property surfaces as `VmHost.CompileFailed`
// AFTER an operator approval has been spent in the enclave. `dotnet build` against these stubs
// takes under a second and catches exactly that class of error, because shape errors are what
// VmHost.CompileFailed reports.
//
// BEHAVIOUR IS DELIBERATELY ABSENT. Every method returns a fixed value. Do not run logic against
// these stubs and do not treat a passing build as proof the contract DECIDES correctly — only that
// it COMPILES.
//
// STATUS: ASSUMED shapes, derived from canon/custom-contracts.md (which is VERIFIED against
// Ork.Forseti.Sdk for IAccessPolicy, the context property names, DokenDto and the Decision
// builder). If the real SDK differs, a stub that is MORE PERMISSIVE than reality yields a false
// PASS — widen or correct the stub and re-run. See README.md.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Ork.Forseti.Sdk
{
    // ---------------------------------------------------------------------
    // Contract entry point
    // ---------------------------------------------------------------------

    public interface IAccessPolicy
    {
        PolicyDecision ValidateData(DataContext ctx);
        PolicyDecision ValidateApprovers(ApproversContext ctx);
        PolicyDecision ValidateExecutor(ExecutorContext ctx);
    }

    // ---------------------------------------------------------------------
    // Decision result
    // ---------------------------------------------------------------------

    public class PolicyDecision
    {
        public bool IsAllowed { get; private set; }
        public string Reason { get; private set; }

        public static PolicyDecision Allow() => new PolicyDecision { IsAllowed = true };

        public static PolicyDecision Deny(string reason) =>
            new PolicyDecision { IsAllowed = false, Reason = reason };

        // NOTE: PolicyDecision.Approve() does NOT exist in the real SDK (see canon). It is
        // deliberately absent here so that using it fails the local build.
    }

    // ---------------------------------------------------------------------
    // Contexts — DISJOINT BY DESIGN.
    //
    // ValidateData sees the bytes. ValidateExecutor sees the doken. NEITHER SEES BOTH.
    // Writing ctx.Data inside ValidateExecutor is the canonical mistake this harness catches:
    //   error CS1061: 'ExecutorContext' does not contain a definition for 'Data'
    // To compare payload identity against signer identity, capture in ValidateData (which always
    // runs) into an instance field, compare in ValidateExecutor, and DENY if it was never set.
    // ---------------------------------------------------------------------

    public class DataContext
    {
        public byte[] Data => Array.Empty<byte>();
        public byte[] DynamicData => Array.Empty<byte>();
        public string RequestId => string.Empty;
    }

    public class ApproversContext
    {
        // NOTE: `Dokens`, not `Approvers` (AP: wrong context properties).
        public List<byte[]> Dokens => new List<byte[]>();
    }

    public class ExecutorContext
    {
        // NOTE: `Doken`, not `Executor`. There is deliberately NO `Data` property here.
        public byte[] Doken => Array.Empty<byte>();
        public string RequestId => string.Empty;
    }

    // ---------------------------------------------------------------------
    // DokenDto — token wrapper
    //
    // UserId returns the VUID. A doken carries NO `sub` claim, so a contract can only ever enforce
    // the vuid — never an OIDC subject (AP-66).
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

        public bool HasRole(string resource, string role) => false;
        public bool HasRole(string realmRole) => false;
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
    // `Decision.X(...)` is the static entry point and returns a chainable DecisionBuilder, which
    // carries the same surface as instance methods so checks compose in any order:
    //   return Decision.RequireNotExpired(x).RequireRole(x, "res", "role");
    // DecisionBuilder converts implicitly to PolicyDecision so the above typechecks in a method
    // returning PolicyDecision.
    //
    // C# forbids a static and an instance method with the same signature on one type, which is why
    // this is split across two types. Keep the two surfaces IDENTICAL — a method present on one and
    // missing from the other produces a build error that depends on where in the chain it appears.
    // ---------------------------------------------------------------------

    public class DecisionBuilder
    {
        public static implicit operator PolicyDecision(DecisionBuilder b) => PolicyDecision.Allow();

        // --- Role checks ---
        public DecisionBuilder RequireRole(DokenDto doken, string resource, string role) => this;
        public DecisionBuilder RequireRole(DokenDto doken, string realmRole) => this;
        public DecisionBuilder RequireAnyRole(DokenDto doken, string resource, params string[] roles) => this;
        public DecisionBuilder RequireAllRoles(DokenDto doken, string resource, params string[] roles) => this;
        public DecisionBuilder ForbidRole(DokenDto doken, string resource, string role) => this;

        // --- Approval checks ---
        public DecisionBuilder RequireMinWithRole(List<DokenDto> approvers, int min, string resource, string role) => this;
        public DecisionBuilder RequireAnyWithRole(List<DokenDto> approvers, string resource, string role) => this;
        public DecisionBuilder ForbidSelfApproval(string requestorId, List<DokenDto> approvers) => this;
        public DecisionBuilder RequireDistinctOrgs(List<DokenDto> approvers, int count) => this;

        // --- Time checks ---
        public DecisionBuilder RequireWeekday() => this;
        public DecisionBuilder RequireBusinessHours() => this;
        public DecisionBuilder RequireHourBetween(int startHour, int endHour) => this;
        public DecisionBuilder ForbidHourBetween(int startHour, int endHour) => this;
        public DecisionBuilder RequireDayOfWeek(DayOfWeek day) => this;

        // --- Token checks ---
        public DecisionBuilder RequireNotExpired(DokenDto doken) => this;
        public DecisionBuilder RequireFromAudience(DokenDto doken, string audience) => this;
        public DecisionBuilder RequireUserId(DokenDto doken, string userId) => this;

        // --- Geo checks ---
        public DecisionBuilder RequireCountry(string country, params string[] allowed) => this;
        public DecisionBuilder ForbidCountry(string country, params string[] blocked) => this;

        // --- Generic ---
        public DecisionBuilder Require(bool condition, string denyReason) => this;
        public DecisionBuilder Forbid(bool condition, string denyReason) => this;
    }

    public static class Decision
    {
        private static DecisionBuilder B() => new DecisionBuilder();

        // --- Role checks ---
        public static DecisionBuilder RequireRole(DokenDto doken, string resource, string role) => B();
        public static DecisionBuilder RequireRole(DokenDto doken, string realmRole) => B();
        public static DecisionBuilder RequireAnyRole(DokenDto doken, string resource, params string[] roles) => B();
        public static DecisionBuilder RequireAllRoles(DokenDto doken, string resource, params string[] roles) => B();
        public static DecisionBuilder ForbidRole(DokenDto doken, string resource, string role) => B();

        // --- Approval checks ---
        public static DecisionBuilder RequireMinWithRole(List<DokenDto> approvers, int min, string resource, string role) => B();
        public static DecisionBuilder RequireAnyWithRole(List<DokenDto> approvers, string resource, string role) => B();
        public static DecisionBuilder ForbidSelfApproval(string requestorId, List<DokenDto> approvers) => B();
        public static DecisionBuilder RequireDistinctOrgs(List<DokenDto> approvers, int count) => B();

        // --- Time checks ---
        public static DecisionBuilder RequireWeekday() => B();
        public static DecisionBuilder RequireBusinessHours() => B();
        public static DecisionBuilder RequireHourBetween(int startHour, int endHour) => B();
        public static DecisionBuilder ForbidHourBetween(int startHour, int endHour) => B();
        public static DecisionBuilder RequireDayOfWeek(DayOfWeek day) => B();

        // --- Token checks ---
        public static DecisionBuilder RequireNotExpired(DokenDto doken) => B();
        public static DecisionBuilder RequireFromAudience(DokenDto doken, string audience) => B();
        public static DecisionBuilder RequireUserId(DokenDto doken, string userId) => B();

        // --- Geo checks ---
        public static DecisionBuilder RequireCountry(string country, params string[] allowed) => B();
        public static DecisionBuilder ForbidCountry(string country, params string[] blocked) => B();

        // --- Generic ---
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

namespace Cryptide.Tools
{
    // Stubbed with the WRONG shape once already, and that miss is exactly why this file exists:
    // a stub whose signature does not match the SDK produces a build error on correct contract
    // code (false FAIL) or hides a real one (false PASS). Correct against the real SDK when known.
    public static class Utils
    {
        public static long GetEpochSeconds() => 0;
        public static byte[] Hash(byte[] data) => Array.Empty<byte>();
        public static string ToHexString(byte[] data) => string.Empty;
        public static byte[] FromHexString(string hex) => Array.Empty<byte>();
    }
}
