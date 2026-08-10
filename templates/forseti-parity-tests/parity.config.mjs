/**
 * Configuration for the Forseti contract parity tests.
 *
 * Edit this file to describe YOUR contract. Everything the tests assert is derived from here,
 * so the tests themselves stay untouched. Leave a section as `null` to skip that check — but
 * read what each one buys before skipping it, because most of them replace a failure that costs
 * an enclave operator approval to discover.
 */

export default {
  /** Path to the contract source, relative to the repo root. REQUIRED. */
  contractPath: 'forseti/MyContract.cs',

  /**
   * The policy's modelId. Must be one of the nine built-ins or `BasicCustom<N>:BasicCustom<V>`.
   * Set to null to skip.
   */
  modelId: 'BasicCustom<MyModel>:BasicCustom<1>',

  /**
   * Every [key, value] pair the policy actually supplies, exactly as passed to `new Policy({params})`.
   * The tests assert this set EQUALS the set of [PolicyParam] properties the contract declares —
   * a required param the policy never sends fails at request time, on the ORKs, after an approval.
   * Set to null to skip.
   */
  suppliedParams: [
    ['SigningRole', 'my-signer'],
    ['SigningResource', 'my-client'],
    ['MaxClockSkewSeconds', '10'],
  ],

  /**
   * Wire-format parity. The contract declares field offsets/indices as
   * `private const int <prefix><NAME> = <n>;`. Map each NAME to the index your encoder writes.
   * If one side is renamed or renumbered this fails loudly instead of silently reading wrong bytes.
   * Set to null if your contract does not use fixed offsets.
   */
  wire: {
    /** The C# constant prefix, e.g. 'F_' for `private const int F_AMOUNT = 1;` */
    prefix: 'F_',
    /** NAME (without prefix) -> index the encoder writes. */
    fields: null, // e.g. { AMOUNT_CENTS: 1, EXECUTOR_VUID: 7 }
    /** Optional: `private const int <name> = <n>;` holding the total field count. */
    countConstant: null, // e.g. 'WIRE_FIELD_COUNT'
    /** The value your encoder uses for that count. */
    countValue: null,
  },

  /**
   * The instance field the contract sets in ValidateData and checks elsewhere (capture-then-compare).
   * The tests assert a Deny guard exists for it — "the check did not run" can only mean refuse.
   * Set to null to skip.
   */
  failClosedFlag: null, // e.g. '_dataValidated' or '_envelopeVuid'

  /**
   * Identity binding. A doken carries no `sub`; `DokenDto.UserId` IS the vuid, so a contract
   * comparing a JWT subject denies every request (AP-66).
   */
  identity: {
    /** A regex source that must appear — the vuid comparison. Set to null to skip. */
    mustMatch: '\\.UserId',
    /** Patterns that must NOT appear anywhere in the contract. */
    mustNotMatch: ['\\.subject\\b', '\\bSubject\\b'],
  },

  /**
   * Method names whose bodies must NOT reference `ctx.Data`. The contexts are disjoint:
   * `ctx.Data` inside ValidateExecutor compiles in an editor and fails ON THE ORK with CS1061,
   * after an approval has been spent.
   */
  dataIsolation: ['ValidateExecutor', 'ValidateApprovers'],

  /**
   * Numeric policy params that must be strictly increasing, in order. A misordered ladder makes
   * the contract deny every request. Set to null to skip.
   */
  strictlyIncreasingParams: null, // e.g. ['Band1MaxCents', 'Band2MaxCents', 'Band3MaxCents']

  /**
   * Extra source-level assertions. Regex-against-source is crude and that is the point: it needs
   * no ORK, no .NET runtime and no enclave. Use it to pin branches the app's UI teaches, so nobody
   * rewires the contract while the UI keeps explaining the old rules.
   */
  sourceAssertions: [
    // { name: 'officer branch keys off the top band',
    //   pattern: '_amountCents >= band3[\\s\\S]{0,120}RequireAnyWithRole', shouldMatch: true },
  ],

  /**
   * Optional: a JSON file holding the DEPLOYED policy, with a `contractId` field. The tests assert
   * it equals a fresh uppercase SHA-512 of the contract source — editing the contract (even a
   * comment) invalidates the deployed policy. Set to null to skip.
   */
  deployedPolicyPath: null, // e.g. 'data/my-policy.json'
  deployedPolicyContractIdKey: 'contractId',
};
