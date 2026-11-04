/**
 * Tools only the orchestrator has. Each call goes to the orchestration controller,
 * which the orchestrator's engine passes in as `ctx.orch`.
 *
 * They are all "read-only" as far as permissions go: they never touch files themselves.
 * The subagents they start ask for permission for their own edits and commands.
 */
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const SpawnAgentTool = {
  name: 'spawn_agent',
  description:
    'Start a subagent that works on one self-contained task in the background, using the model you choose. ' +
    'Returns immediately with an agent_id; use wait_agents to get its report. ' +
    'The subagent has all coding tools (read, search, edit, write, bash, fetch) but no memory of this conversation, ' +
    'so the task must contain every detail it needs: goal, relevant files, constraints and what to report back.',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Model id from the catalog in your instructions' },
      task: { type: 'string', description: 'Complete, self-contained instructions for the subagent' },
      name: { type: 'string', description: 'Short label for the task, e.g. "write tests" (shown to the user)' },
      reasoning: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Reasoning effort, if the model supports it' },
    },
    required: ['model', 'task'],
  },
  isReadOnly: true,
  userFacingName: () => 'Spawn',
  renderInput: (input) => `${input.model} · ${shorten(input.name || input.task || '', 60)}`,
  validate(input, ctx) {
    if (!ctx.orch) return 'Orchestration is not running.';
    return ctx.orch.validateSpawn(input);
  },
  async call(input, ctx) {
    const agent = ctx.orch.spawn(input);
    return {
      output: JSON.stringify({ agent_id: agent.id, model: agent.model, status: agent.status }),
      display: { kind: 'summary', text: { key: agent.status === 'queued' ? 'orch.tool.queued' : 'orch.tool.spawned', n: agent.n, model: agent.model } },
    };
  },
};

export const WaitAgentsTool = {
  name: 'wait_agents',
  description:
    'Wait until subagents finish and return their reports. Without agent_ids it waits for every unfinished agent. ' +
    'Returns early when timeout_seconds passes; agents still running are listed with status "running".',
  inputSchema: {
    type: 'object',
    properties: {
      agent_ids: { type: 'array', items: { type: 'string' }, description: 'Agents to wait for (default: all unfinished)' },
      timeout_seconds: { type: 'number', description: 'Give up waiting after this many seconds (default 600)' },
    },
    required: [],
  },
  isReadOnly: true,
  userFacingName: () => 'Wait',
  renderInput: (input) => (input.agent_ids?.length ? input.agent_ids.join(', ') : 'all agents'),
  async call(input, ctx) {
    const reports = await ctx.orch.wait(input.agent_ids, input.timeout_seconds, ctx.signal);
    const done = reports.filter((r) => r.status === 'done').length;
    const failed = reports.filter((r) => r.status === 'failed' || r.status === 'cancelled').length;
    const running = reports.length - done - failed;
    return {
      output: JSON.stringify(reports, null, 2),
      display: { kind: 'summary', text: { key: 'orch.tool.waited', done, failed, running } },
    };
  },
};

export const AgentStatusTool = {
  name: 'agent_status',
  description: 'List every subagent with its model, status, current activity and elapsed time. Does not wait.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  isReadOnly: true,
  userFacingName: () => 'Status',
  renderInput: () => '',
  async call(input, ctx) {
    const list = ctx.orch.status();
    return {
      output: JSON.stringify(list, null, 2),
      display: { kind: 'summary', text: { key: 'orch.tool.status', n: list.length } },
    };
  },
};

export const CancelAgentTool = {
  name: 'cancel_agent',
  description: 'Stop a running or queued subagent.',
  inputSchema: {
    type: 'object',
    properties: { agent_id: { type: 'string' } },
    required: ['agent_id'],
  },
  isReadOnly: true,
  userFacingName: () => 'Cancel',
  renderInput: (input) => input.agent_id,
  async call(input, ctx) {
    const ok = ctx.orch.cancel(input.agent_id);
    if (!ok) throw new Error(`No running agent ${input.agent_id}`);
    return { output: `Cancelled ${input.agent_id}.`, display: { kind: 'summary', text: { key: 'orch.tool.cancelled', id: input.agent_id } } };
  },
};

export const ORCH_TOOLS = [SpawnAgentTool, WaitAgentsTool, AgentStatusTool, CancelAgentTool];
