using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
	[PolicyParam(Required = false, Description = "Role required for data encryption")]
    public string EncryptionRealmRole { get; set; }

	[PolicyParam(Required = false, Description = "Role required for data decryption")]
    public string DecryptionRealmRole { get; set; }

	private bool isEncryptionRequest = false;
	private List<string> DataTags = new();

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

		if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE)
		{
			return PolicyDecision.Deny("Policy used against this contract must be EXPLICIT PRIVATE");
		}

		// Extract tags from ctx.Data
		ReadOnlyMemory<byte> data = ctx.Data;
		if(isEncryptionRequest)
		{
			var time = data.GetValue(0);
			ReadOnlyMemory<byte> firstEncryptionRequest = data.GetValue(1);
			for (int i = 2; firstEncryptionRequest.TryGetValue(i, out var tag); i++)
			{
				this.DataTags.Add(Encoding.UTF8.GetString(tag.Span));
			}
		}
		else
		{
			var firstDecryptionRequest = data.GetValue(0);
			for (int i = 3; firstDecryptionRequest.TryGetValue(i, out var tag); i++)
			{
				this.DataTags.Add(Encoding.UTF8.GetString(tag.Span));
			}
		}

		// Enforce Time Lock from tags if decryption request
		if(!isEncryptionRequest)
		{
			foreach(var tag in DataTags)
			{
				if(tag.StartsWith("DecryptTimeLock:"))
				{
					var val = tag.Substring("DecryptTimeLock:".Length);
					if(int.TryParse(val, out int lockEpoch))
					{
						var currentTime = (int)Utils.GetEpochSeconds();
						if(currentTime < lockEpoch)
						{
							return PolicyDecision.Deny("Time lock preventing decryption until " + lockEpoch);
						}
					}
				}
			}
		}

        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
		var executor = new DokenDto(ctx.Doken);
		// encryption request and encrytion role set
		if(isEncryptionRequest && EncryptionRealmRole != null)
		{
			return Decision
				.RequireNotExpired(executor)
				.RequireRole(executor, EncryptionRealmRole);
		}
		// decryption request and decryption role set
		else if(!isEncryptionRequest && DecryptionRealmRole != null)
		{
			return Decision
				.RequireNotExpired(executor)
				.RequireRole(executor, DecryptionRealmRole);
		}
		else return PolicyDecision.Allow(); // no restrictions on executor
    }
}