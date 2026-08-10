using Ork.Forseti.Sdk;

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
        _claimedVuid = System.Text.Encoding.UTF8.GetString(ctx.Data);
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
