// TYPING: rom
// This discriminator only exists under the ReadOnlyMemory<byte> candidate typing of
// ctx.Data. Under the byte[] candidate, indexing and foreach are legal, so this file
// compiles and that is NOT stub drift. check.sh runs it against the rom variant only.
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
