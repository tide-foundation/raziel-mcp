using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

// MUST NOT COMPILE — exactly ONE error: ReadOnlyMemory<byte> has no indexer; byte[] does (use .Span[0])
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) {
        byte b = ctx.Data[0]; _ = b;
        return PolicyDecision.Allow();
    }
}
