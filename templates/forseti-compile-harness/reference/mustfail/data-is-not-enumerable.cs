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

// MUST NOT COMPILE — exactly ONE error: ctx.Data treated as a collection (the DataItem misconception)
public class Contract : IAccessPolicy {
    public PolicyDecision ValidateData(DataContext ctx) {
        foreach (var item in ctx.Data) { _ = item; }
        return PolicyDecision.Allow();
    }
}
