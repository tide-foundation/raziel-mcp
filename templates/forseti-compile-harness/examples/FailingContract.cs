using Ork.Forseti.Sdk;
public class Contract : IAccessPolicy
{
    public PolicyDecision ValidateData(DataContext ctx) => PolicyDecision.Allow();
    public PolicyDecision ValidateApprovers(ApproversContext ctx) => PolicyDecision.Allow();
    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var payload = ctx.Data;                      // L-17: ExecutorContext has no Data
        var approvers = DokenDto.WrapAll(ctx.Approvers);  // wrong property name
        return PolicyDecision.Approve();             // does not exist
    }
}
