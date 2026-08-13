using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: a PolicyDecision cannot be inspected either (no IsAllowed)
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) {
        PolicyDecision d = PolicyDecision.Allow();
        if (d.IsAllowed) return d;
        return PolicyDecision.Deny("no");
    }
}
