using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: PolicyDecision.Approve() does not exist
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) => PolicyDecision.Approve();
}
