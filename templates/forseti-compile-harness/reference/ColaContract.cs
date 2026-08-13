using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;


/// <summary>
/// Super secret Cola encryption / decryption contract, specifically for the Cola organisation.
/// </summary>
public class Contract : IAccessPolicy
{
	private bool isEncryptionRequest = false;
	private List<string> DataTags = new();
	private string ApproverSuccessfulRole = null;
	
	private const string Ingredients = "ingredients";
	private const string BatchAmounts = "batch amounts";
	private const string Process = "process";
	
	private const string Executive = "executive";
	private const string FactoryOperator = "factoryoperator";
	private const string ProcurementOfficer = "procurementofficer";

	
    public PolicyDecision ValidateData(DataContext ctx)
    {
		if(ctx.RequestId == "PolicyEnabledEncryption:1")
		{
			isEncryptionRequest = true;
		}
		else if(ctx.RequestId == "PolicyEnabledDecryption:1")
		{
			isEncryptionRequest = false;
		}
		else
		{
			return PolicyDecision.Deny("This contract must only be used with Policy Enabled Encryption/Decryption requests");
		}
		
		if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE || ctx.Policy.ApprovalType != ApprovalType.EXPLICIT)
		{
			return PolicyDecision.Deny("Policy used against this contract must be EXPLICIT PRIVATE");
		}

		ReadOnlyMemory<byte> data = ctx.Data;
		if(isEncryptionRequest)
		{
			var time = data.GetValue(0);
			ReadOnlyMemory<byte> firstEncryptionRequest = data.GetValue(1);
			if(data.TryGetValue(2, out var _)) return PolicyDecision.Deny("Only one piece of data is allowed to be encrypted per execution.");
			
			for (int i = 2; firstEncryptionRequest.TryGetValue(i, out var tag); i++)
			{
				this.DataTags.Add(Encoding.UTF8.GetString(tag.Span));
			}
		}
		else
		{
			var firstDecryptionRequest = data.GetValue(0);
			if(data.TryGetValue(1, out var _)) return PolicyDecision.Deny("Only one piece of data is allowed to be decrypted per execution.");
			
			for (int i = 3; firstDecryptionRequest.TryGetValue(i, out var tag); i++)
			{
				this.DataTags.Add(Encoding.UTF8.GetString(tag.Span));
			}
		}
		
		if (DataTags.Count == 0) return PolicyDecision.Deny("At least one data tag is required.");
		
		foreach (var tag in DataTags)
		{
			if (!IsAllowedTag(tag))
			{
				return PolicyDecision.Deny("You may only add the data tags 'ingredients', 'batch amounts' or 'process' for this contract that protects the Cola Recipe");
			}
		}

        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
		var approvers = DokenDto.WrapAll(ctx.Dokens);
		
		if(isEncryptionRequest) 
		{
			int executiveCount = CountWithRole(approvers, Executive);
			if(executiveCount >= 3)
			{
				ApproverSuccessfulRole = Executive;
				return PolicyDecision.Allow();
			}
			else 
			{
				return PolicyDecision.Deny("Not enough approvals to request encryption");
			}
		}
		else
		{
			int executiveCount = CountWithRole(approvers, Executive);
			int factoryCount = CountWithRole(approvers, FactoryOperator);
			int procurementCount = CountWithRole(approvers, ProcurementOfficer);
			
			if(executiveCount >= 1)
			{
				ApproverSuccessfulRole = Executive;
				return PolicyDecision.Allow();
			}
			else if(factoryCount >= 2 && AllTagsAre(BatchAmounts, Process))
			{
				ApproverSuccessfulRole = FactoryOperator;
				return PolicyDecision.Allow();
			}
			else if(procurementCount >= 2 && AllTagsAre(Ingredients, BatchAmounts))
			{
				ApproverSuccessfulRole = ProcurementOfficer;
				return PolicyDecision.Allow();
			}
			else 
			{
				return PolicyDecision.Deny("Not enough approvals to request decryption");
			}
		}
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
		if(ApproverSuccessfulRole == null)
		{
			return PolicyDecision.Deny("No successful approver role");
		}
		
        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, ApproverSuccessfulRole);
    }
	
	private static bool IsAllowedTag(string tag)
	{
		return tag == Ingredients || tag == BatchAmounts || tag == Process;
	}
	
	private static int CountWithRole(List<DokenDto> approvers, string role)
	{
		int count = 0;
		foreach (var approver in approvers)
		{
			if (approver.HasRole(role)) count++;
		}
		return count;
	}
	
	private bool AllTagsAre(string allowed1, string allowed2)
	{
		foreach (var tag in DataTags)
		{
			if (tag != allowed1 && tag != allowed2) return false;
		}
		return true;
	}
}