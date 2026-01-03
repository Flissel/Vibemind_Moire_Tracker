/**
 * Agent Team - Koordiniertes Multi-Agenten-System für UI-Automation
 * 
 * Drei spezialisierte Agenten arbeiten zusammen:
 * - TaskPlanner: Zerlegt komplexe Aufgaben in ausführbare Schritte
 * - VisionAgent: Analysiert Screen-Zustand mit CNN + Detections
 * - ActionAgent: Führt konkrete UI-Aktionen aus
 */

import { EventEmitter } from 'events';

// OpenAI type definitions
interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAIChatChoice {
  message: {
    content: string | null;
  };
}

interface OpenAIChatCompletion {
  choices: OpenAIChatChoice[];
}

interface OpenAIChatCompletionsAPI {
  create(params: {
    model: string;
    messages: OpenAIChatMessage[];
    temperature?: number;
    response_format?: { type: string };
  }): Promise<OpenAIChatCompletion>;
}

interface OpenAIClient {
  chat: {
    completions: OpenAIChatCompletionsAPI;
  };
}

interface OpenAIConstructor {
  new (config: { apiKey: string }): OpenAIClient;
}

// OpenAI import with fallback
let OpenAI: OpenAIConstructor | null = null;
try {
  OpenAI = require('openai').default || require('openai');
} catch {
  OpenAI = null;
}

// ============= TYPES =============

export type AgentRole = 'planner' | 'vision' | 'action';

export interface DetectedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  confidence: number;
  cnnCategory?: string;
  attributes?: Record<string, unknown>;
}

export interface ScreenState {
  timestamp: number;
  elements: DetectedElement[];
  screenshot?: string;
  windowTitle?: string;
  dimensions: { width: number; height: number };
  focusedElement?: string;
}

export interface TaskStep {
  id: string;
  action: ActionType;
  target?: string;
  params?: Record<string, unknown>;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused';
  createdAt: number;
  completedAt?: number;
  context: Record<string, unknown>;
}

export type ActionType = 
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'press_key'
  | 'scroll'
  | 'drag'
  | 'wait'
  | 'verify'
  | 'screenshot'
  | 'find_element'
  | 'read_text'
  | 'custom';

export interface ActionRequest {
  type: ActionType;
  target?: { x: number; y: number } | string;
  params?: {
    text?: string;
    key?: string;
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
    duration?: number;
    condition?: string;
    description?: string;
    [key: string]: unknown;
  };
}

export interface ActionResult {
  success: boolean;
  action: ActionType;
  duration: number;
  error?: string;
  data?: unknown;
}

export interface AgentMessage {
  from: AgentRole;
  to: AgentRole | 'coordinator';
  type: 'request' | 'response' | 'update' | 'error';
  content: unknown;
  timestamp: number;
}

// ============= Process Input Types =============

interface PlannerProcessInput {
  action: 'create_plan' | 'get_next_step' | 'complete_step' | 'fail_step';
  goal?: string;
  planId?: string;
  context?: Record<string, unknown>;
}

interface VisionProcessInput {
  action: 'update_state' | 'find_element' | 'get_state' | 'get_element';
  data?: {
    elements?: DetectedElement[];
    screenshot?: string;
    dimensions?: { width: number; height: number };
    description?: string;
    id?: string;
  };
}

interface ActionProcessInput {
  action: 'execute_immediate' | 'clear_queue' | 'stop' | 'get_status';
  request?: ActionRequest;
  data?: unknown;
}

// ============= BASE AGENT =============

abstract class BaseAgent extends EventEmitter {
  protected role: AgentRole;
  protected openai: OpenAIClient | null = null;
  protected model: string = 'gpt-4o-mini';
  protected isInitialized: boolean = false;

  constructor(role: AgentRole) {
    super();
    this.role = role;
  }

  async initialize(apiKey?: string): Promise<boolean> {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key && OpenAI) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.isInitialized = true;
    return true;
  }

  getRole(): AgentRole {
    return this.role;
  }

  protected sendMessage(to: AgentRole | 'coordinator', type: AgentMessage['type'], content: unknown) {
    const message: AgentMessage = {
      from: this.role,
      to,
      type,
      content,
      timestamp: Date.now()
    };
    this.emit('message', message);
  }

  abstract process(input: PlannerProcessInput | VisionProcessInput | ActionProcessInput): Promise<unknown>;
}

// ============= TASK PLANNER AGENT =============

interface RawTaskStep {
  action: string;
  target?: string;
  params?: Record<string, unknown>;
  description?: string;
}

export class TaskPlannerAgent extends BaseAgent {
  private activePlans: Map<string, TaskPlan> = new Map();
  private planHistory: TaskPlan[] = [];

  constructor() {
    super('planner');
  }

  async createPlan(goal: string, context?: Record<string, unknown>): Promise<TaskPlan> {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const plan: TaskPlan = {
      id: planId,
      goal,
      steps: [],
      currentStepIndex: 0,
      status: 'planning',
      createdAt: Date.now(),
      context: context || {}
    };

    if (this.openai) {
      try {
        plan.steps = await this.generateStepsWithLLM(goal, context);
      } catch (error) {
        console.warn('[TaskPlanner] LLM planning failed, using rule-based fallback');
        plan.steps = this.generateStepsRuleBased(goal);
      }
    } else {
      plan.steps = this.generateStepsRuleBased(goal);
    }

    if (plan.steps.length > 0) {
      plan.status = 'executing';
    } else {
      plan.status = 'failed';
    }

    this.activePlans.set(planId, plan);
    this.emit('plan_created', plan);
    
    return plan;
  }

  private async generateStepsWithLLM(goal: string, context?: Record<string, unknown>): Promise<TaskStep[]> {
    const systemPrompt = `Du bist ein UI-Automation Task Planner. 
Zerlege das gegebene Ziel in konkrete, ausführbare Schritte.

Verfügbare Aktionen:
- click: Klick auf Element
- double_click: Doppelklick
- right_click: Rechtsklick
- type: Text eingeben
- press_key: Taste drücken (Enter, Tab, Escape, etc.)
- scroll: Scrollen (up/down)
- wait: Warten (ms)
- verify: Zustand überprüfen
- find_element: Element suchen

Antworte als JSON-Array mit Schritten:
[
  {"action": "click", "target": "Beschreibung des Elements", "description": "Was dieser Schritt tut"},
  ...
]`;

    const response = await this.openai!.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Ziel: ${goal}\n\nKontext: ${JSON.stringify(context || {})}` }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '{"steps":[]}';
    const parsed = JSON.parse(content) as { steps?: RawTaskStep[] } | RawTaskStep[];
    const rawSteps: RawTaskStep[] = Array.isArray(parsed) ? parsed : (parsed.steps || []);

    return rawSteps.map((step: RawTaskStep, index: number) => ({
      id: `step_${index + 1}`,
      action: step.action as ActionType,
      target: step.target,
      params: step.params,
      description: step.description || `Schritt ${index + 1}`,
      status: 'pending' as const
    }));
  }

  private generateStepsRuleBased(goal: string): TaskStep[] {
    const steps: TaskStep[] = [];
    const goalLower = goal.toLowerCase();

    if (goalLower.includes('öffne') || goalLower.includes('open')) {
      steps.push({
        id: 'step_1',
        action: 'find_element',
        target: goal.replace(/öffne|open/gi, '').trim(),
        description: 'Finde Element zum Öffnen',
        status: 'pending'
      });
      steps.push({
        id: 'step_2',
        action: 'click',
        description: 'Klick auf gefundenes Element',
        status: 'pending'
      });
    } else if (goalLower.includes('klick') || goalLower.includes('click')) {
      steps.push({
        id: 'step_1',
        action: 'find_element',
        target: goal.replace(/klick|click|auf/gi, '').trim(),
        description: 'Finde Element zum Klicken',
        status: 'pending'
      });
      steps.push({
        id: 'step_2',
        action: 'click',
        description: 'Führe Klick aus',
        status: 'pending'
      });
    } else {
      steps.push({
        id: 'step_1',
        action: 'screenshot',
        description: 'Screenshot aufnehmen',
        status: 'pending'
      });
      steps.push({
        id: 'step_2',
        action: 'verify',
        params: { condition: goal },
        description: 'Zustand analysieren',
        status: 'pending'
      });
    }

    return steps;
  }

  getNextStep(planId: string): TaskStep | null {
    const plan = this.activePlans.get(planId);
    if (!plan || plan.status !== 'executing') return null;
    
    if (plan.currentStepIndex >= plan.steps.length) {
      plan.status = 'completed';
      plan.completedAt = Date.now();
      this.planHistory.push(plan);
      this.emit('plan_completed', plan);
      return null;
    }

    return plan.steps[plan.currentStepIndex];
  }

  completeStep(planId: string, result: unknown): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;

    const step = plan.steps[plan.currentStepIndex];
    if (step) {
      step.status = 'completed';
      step.result = result;
      plan.currentStepIndex++;
      this.emit('step_completed', { plan, step, result });
    }
  }

  failStep(planId: string, error: string): void {
    const plan = this.activePlans.get(planId);
    if (!plan) return;

    const step = plan.steps[plan.currentStepIndex];
    if (step) {
      step.status = 'failed';
      step.error = error;
      plan.status = 'failed';
      this.emit('step_failed', { plan, step, error });
    }
  }

  getPlan(planId: string): TaskPlan | undefined {
    return this.activePlans.get(planId);
  }

  getAllPlans(): TaskPlan[] {
    return Array.from(this.activePlans.values());
  }

  async process(input: PlannerProcessInput): Promise<unknown> {
    switch (input.action) {
      case 'create_plan':
        return this.createPlan(input.goal || '', input.context);
      case 'get_next_step':
        return this.getNextStep(input.planId || '');
      case 'complete_step':
        this.completeStep(input.planId || '', input.context);
        return { success: true };
      case 'fail_step':
        this.failStep(input.planId || '', (input.context as { error?: string })?.error || 'Unknown error');
        return { success: true };
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
  }
}

// ============= VISION AGENT =============

export class VisionAgent extends BaseAgent {
  private currentState: ScreenState | null = null;
  private elementCache: Map<string, DetectedElement> = new Map();

  constructor() {
    super('vision');
  }

  updateScreenState(elements: DetectedElement[], screenshot?: string, dimensions?: { width: number; height: number }): ScreenState {
    const state: ScreenState = {
      timestamp: Date.now(),
      elements,
      screenshot,
      dimensions: dimensions || { width: 1920, height: 1080 }
    };

    this.elementCache.clear();
    for (const el of elements) {
      this.elementCache.set(el.id, el);
    }

    this.currentState = state;
    this.emit('state_updated', state);
    
    return state;
  }

  async findElement(description: string): Promise<DetectedElement | null> {
    if (!this.currentState) return null;

    for (const el of this.currentState.elements) {
      if (el.text && el.text.toLowerCase() === description.toLowerCase()) {
        return el;
      }
    }

    for (const el of this.currentState.elements) {
      if (el.text && el.text.toLowerCase().includes(description.toLowerCase())) {
        return el;
      }
    }

    return null;
  }

  getElementById(id: string): DetectedElement | undefined {
    return this.elementCache.get(id);
  }

  getCurrentState(): ScreenState | null {
    return this.currentState;
  }

  async process(input: VisionProcessInput): Promise<unknown> {
    switch (input.action) {
      case 'update_state':
        return this.updateScreenState(
          input.data?.elements || [],
          input.data?.screenshot,
          input.data?.dimensions
        );
      case 'find_element':
        return this.findElement(input.data?.description || '');
      case 'get_state':
        return this.getCurrentState();
      case 'get_element':
        return this.getElementById(input.data?.id || '');
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
  }
}

// ============= ACTION AGENT =============

export class ActionAgent extends BaseAgent {
  private actionQueue: ActionRequest[] = [];
  private isExecuting: boolean = false;
  private lastAction: ActionResult | null = null;
  private actionExecutors: Map<ActionType, (request: ActionRequest) => Promise<ActionResult>> = new Map();

  constructor() {
    super('action');
    this.initializeDefaultExecutors();
  }

  private initializeDefaultExecutors() {
    this.actionExecutors.set('wait', async (req) => {
      const ms = (req.params?.duration as number) || 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      return { success: true, action: 'wait', duration: ms };
    });

    this.actionExecutors.set('verify', async (_req) => {
      return { success: true, action: 'verify', duration: 0, data: { verified: true } };
    });
  }

  registerExecutor(action: ActionType, executor: (request: ActionRequest) => Promise<ActionResult>) {
    this.actionExecutors.set(action, executor);
  }

  async executeImmediate(request: ActionRequest): Promise<ActionResult> {
    const startTime = Date.now();
    
    const executor = this.actionExecutors.get(request.type);
    if (!executor) {
      throw new Error(`No executor registered for action: ${request.type}`);
    }

    const result = await executor(request);
    result.duration = Date.now() - startTime;
    this.lastAction = result;

    return result;
  }

  stop(): void {
    this.actionQueue = [];
    this.isExecuting = false;
    this.emit('execution_stopped');
  }

  isActionExecuting(): boolean {
    return this.isExecuting;
  }

  getQueueLength(): number {
    return this.actionQueue.length;
  }

  async process(input: ActionProcessInput): Promise<unknown> {
    switch (input.action) {
      case 'execute_immediate':
        return this.executeImmediate(input.request!);
      case 'clear_queue':
        this.actionQueue = [];
        return { success: true };
      case 'stop':
        this.stop();
        return { success: true };
      case 'get_status':
        return {
          isExecuting: this.isExecuting,
          queueLength: this.actionQueue.length,
          lastAction: this.lastAction
        };
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
  }
}

// ============= AGENT COORDINATOR =============

export interface AgentTeamConfig {
  openaiApiKey?: string;
  enableLLM?: boolean;
  autoExecute?: boolean;
  maxConcurrentPlans?: number;
}

export class AgentCoordinator extends EventEmitter {
  private planner: TaskPlannerAgent;
  private vision: VisionAgent;
  private action: ActionAgent;
  
  private config: AgentTeamConfig;
  private messageLog: AgentMessage[] = [];
  private isRunning: boolean = false;

  constructor(config: AgentTeamConfig = {}) {
    super();
    this.config = {
      enableLLM: true,
      autoExecute: false,
      maxConcurrentPlans: 3,
      ...config
    };

    this.planner = new TaskPlannerAgent();
    this.vision = new VisionAgent();
    this.action = new ActionAgent();

    this.setupAgentCommunication();
  }

  async initialize(): Promise<boolean> {
    const apiKey = this.config.openaiApiKey || process.env.OPENAI_API_KEY;
    
    await this.planner.initialize(this.config.enableLLM ? apiKey : undefined);
    await this.vision.initialize(this.config.enableLLM ? apiKey : undefined);
    await this.action.initialize(this.config.enableLLM ? apiKey : undefined);

    this.isRunning = true;
    this.emit('initialized');
    
    return true;
  }

  private setupAgentCommunication() {
    const agents = [this.planner, this.vision, this.action];
    
    for (const agent of agents) {
      agent.on('message', (msg: AgentMessage) => {
        this.messageLog.push(msg);
        this.emit('agent_message', msg);
      });
    }

    this.planner.on('plan_created', (plan) => this.emit('plan_created', plan));
    this.planner.on('plan_completed', (plan) => this.emit('plan_completed', plan));
    this.vision.on('state_updated', (state) => this.emit('state_updated', state));
    this.action.on('action_completed', (result) => this.emit('action_completed', result));
  }

  async startTask(goal: string, context?: Record<string, unknown>): Promise<TaskPlan> {
    return this.planner.createPlan(goal, context);
  }

  async executeStep(planId: string, step: TaskStep): Promise<ActionResult> {
    let targetCoords: { x: number; y: number } | undefined;
    if (typeof step.target === 'string') {
      const element = await this.vision.findElement(step.target);
      if (element) {
        targetCoords = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
      }
    }

    const request: ActionRequest = {
      type: step.action,
      target: targetCoords || step.target,
      params: step.params as ActionRequest['params']
    };

    step.status = 'in_progress';
    
    try {
      const result = await this.action.executeImmediate(request);
      
      if (result.success) {
        this.planner.completeStep(planId, result);
      } else {
        this.planner.failStep(planId, result.error || 'Action failed');
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.planner.failStep(planId, errorMsg);
      return {
        success: false,
        action: step.action,
        duration: 0,
        error: errorMsg
      };
    }
  }

  updateScreenState(elements: DetectedElement[], screenshot?: string, dimensions?: { width: number; height: number }): ScreenState {
    return this.vision.updateScreenState(elements, screenshot, dimensions);
  }

  async findElement(description: string): Promise<DetectedElement | null> {
    return this.vision.findElement(description);
  }

  async executeAction(request: ActionRequest): Promise<ActionResult> {
    return this.action.executeImmediate(request);
  }

  registerActionExecutor(action: ActionType, executor: (request: ActionRequest) => Promise<ActionResult>) {
    this.action.registerExecutor(action, executor);
  }

  getStatus(): Record<string, unknown> {
    return {
      isRunning: this.isRunning,
      planner: {
        activePlans: this.planner.getAllPlans().length
      },
      vision: {
        currentState: this.vision.getCurrentState() ? 'available' : 'none',
        elementCount: this.vision.getCurrentState()?.elements.length || 0
      },
      action: {
        isExecuting: this.action.isActionExecuting(),
        queueLength: this.action.getQueueLength()
      }
    };
  }

  getPlan(planId: string): TaskPlan | undefined {
    return this.planner.getPlan(planId);
  }

  getAllPlans(): TaskPlan[] {
    return this.planner.getAllPlans();
  }

  stop(): void {
    this.action.stop();
    this.isRunning = false;
    this.emit('stopped');
  }

  getPlanner(): TaskPlannerAgent { return this.planner; }
  getVision(): VisionAgent { return this.vision; }
  getAction(): ActionAgent { return this.action; }
}

// ============= SINGLETON =============

let agentTeamInstance: AgentCoordinator | null = null;

export function getAgentTeam(config?: AgentTeamConfig): AgentCoordinator {
  if (!agentTeamInstance) {
    agentTeamInstance = new AgentCoordinator(config);
  }
  return agentTeamInstance;
}

export function resetAgentTeam(): void {
  if (agentTeamInstance) {
    agentTeamInstance.stop();
    agentTeamInstance = null;
  }
}

export { BaseAgent };
export default AgentCoordinator;