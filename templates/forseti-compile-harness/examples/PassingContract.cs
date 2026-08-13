using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true, Description = "Role required to execute")]
    public string Role { get; set; }

    [PolicyParam(Default = 2, Min = 1)]
    public int MinApprovers { get; set; }

    private string _claimedVuid = null;

    public PolicyDecision ValidateData(DataContext ctx)
    {
        if (ctx.RequestId == "PolicyEnabledEncryption:1") return PolicyDecision.Allow();
        // ctx.Data is a NESTED TideMemory (ReadOnlyMemory<byte>), not a flat buffer and not a
        // collection of objects. Walk it with GetValue / TryGetValue and read leaves via .Span.
        ReadOnlyMemory<byte> data = ctx.Data;
        if (data.TryGetValue(0, out var vuidLeaf))
            _claimedVuid = Encoding.UTF8.GetString(vuidLeaf.Span);
        if (string.IsNullOrEmpty(_claimedVuid)) return PolicyDecision.Deny("no vuid");
        return Decision.RequireWeekday().RequireHourBetween(9, 17);
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        var approvers = DokenDto.WrapAll(ctx.Dokens);
        return Decision.RequireMinWithRole(approvers, MinApprovers, "res", Role);
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        if (_claimedVuid == null) return PolicyDecision.Deny("identity check did not run");
        var executor = new DokenDto(ctx.Doken);
        var country = ForsetiSdk.Claim("country") as string;
        ForsetiSdk.Log("checking");
        var now = Cryptide.Tools.Utils.GetEpochSeconds();
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, "res", Role);
    }
}
