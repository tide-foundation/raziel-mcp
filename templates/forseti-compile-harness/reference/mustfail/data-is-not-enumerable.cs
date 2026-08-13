using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: ctx.Data treated as a collection (the DataItem misconception)
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) {
        foreach (var item in ctx.Data) { _ = item; }
        return PolicyDecision.Allow();
    }
}
