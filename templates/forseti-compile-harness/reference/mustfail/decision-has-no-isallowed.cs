using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: a decision cannot be inspected — no IsAllowed
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) => PolicyDecision.Allow();
    public PolicyDecision ValidateExecutor(ExecutorContext ctx) {
        var d = Decision.RequireNotExpired(new DokenDto(ctx.Doken));
        if (d.IsAllowed) return PolicyDecision.Allow();
        return PolicyDecision.Deny("no");
    }
}
