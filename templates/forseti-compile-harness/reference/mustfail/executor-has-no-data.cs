using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: ctx.Data on ExecutorContext — the contexts are disjoint
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) => PolicyDecision.Allow();
    public PolicyDecision ValidateExecutor(ExecutorContext ctx) {
        var p = ctx.Data; _ = p;
        return PolicyDecision.Allow();
    }
}
