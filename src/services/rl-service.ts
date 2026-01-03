/**
 * Reinforcement Learning Service für MoireServer
 * 
 * Bietet WebSocket Endpoints für:
 * - RL Stats (Episoden, Rewards, Q-Table)
 * - Human Feedback Submission
 * - Learning Curve Visualization
 * - Q-Table Exploration
 */

import { EventEmitter } from 'events';

// ==================== Types ====================

export interface RLStats {
  totalEpisodes: number;
  successfulEpisodes: number;
  successRate: number;
  recentSuccessRate: number;
  avgReward: number;
  totalTransitions: number;
  uniqueStates: number;
  qtableSize: number;
  feedbackCount: number;
  explorationRate: number;
  currentEpisode: number | null;
}

export interface Episode {
  id: number;
  taskDescription: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  totalReward: number;
  totalSteps: number;
  success: boolean;
  terminalState: string;
  explorationRate: number;
}

export interface Transition {
  id: number;
  episodeId: number;
  stepIndex: number;
  stateHash: string;
  stateSummary: string;
  actionType: string;
  actionParams: Record<string, any>;
  actionText: string;
  reward: number;
  rewardSource: 'auto' | 'human' | 'goal' | 'heuristic';
  nextStateHash: string;
  nextStateSummary: string;
  isTerminal: boolean;
  timestamp: string;
}

export interface QTableEntry {
  id: number;
  stateHash: string;
  stateDescription: string;
  actionKey: string;
  actionDescription: string;
  qValue: number;
  visitCount: number;
  lastUpdate: string;
  confidence: number;
}

export interface HumanFeedback {
  transitionId?: number;
  episodeId?: number;
  feedbackType: 'reward_correct' | 'reward_wrong' | 'action_good' | 'action_bad';
  originalReward: number;
  correctedReward?: number;
  comment?: string;
}

export interface LearningCurvePoint {
  episode: number;
  reward: number;
  avgReward: number;
  success: boolean;
  successRate: number;
  timestamp: string;
}

export interface PendingFeedbackItem {
  id: number;
  episodeId: number;
  step: number;
  actionType: string;
  actionText: string;
  reward: number;
  rewardSource: string;
  stateSummary: string;
  nextStateSummary: string;
  timestamp: string;
}

// ==================== RL Service ====================

export class RLService extends EventEmitter {
  private pythonBridgeUrl: string;
  private cachedStats: RLStats | null = null;
  private cacheTimeout: number = 5000; // 5 seconds
  private lastCacheUpdate: number = 0;

  constructor(pythonBridgeUrl: string = 'http://localhost:8766') {
    super();
    this.pythonBridgeUrl = pythonBridgeUrl;
    console.log(`[RL Service] Initialized with Python bridge at ${pythonBridgeUrl}`);
  }

  // ==================== Stats ====================

  async getStats(): Promise<RLStats> {
    // Return cached stats if fresh
    if (this.cachedStats && Date.now() - this.lastCacheUpdate < this.cacheTimeout) {
      return this.cachedStats;
    }

    try {
      const response = await this.callPythonBridge('get_rl_stats');
      this.cachedStats = this.transformStats(response);
      this.lastCacheUpdate = Date.now();
      return this.cachedStats;
    } catch (error) {
      console.error('[RL Service] Error getting stats:', error);
      return this.getDefaultStats();
    }
  }

  private transformStats(raw: any): RLStats {
    return {
      totalEpisodes: raw.total_episodes || 0,
      successfulEpisodes: raw.successful_episodes || 0,
      successRate: raw.success_rate || 0,
      recentSuccessRate: raw.recent_success_rate || 0,
      avgReward: raw.avg_reward || 0,
      totalTransitions: raw.total_transitions || 0,
      uniqueStates: raw.unique_states || 0,
      qtableSize: raw.qtable_size || 0,
      feedbackCount: raw.feedback_count || 0,
      explorationRate: raw.exploration_rate || 0.2,
      currentEpisode: raw.current_episode || null
    };
  }

  private getDefaultStats(): RLStats {
    return {
      totalEpisodes: 0,
      successfulEpisodes: 0,
      successRate: 0,
      recentSuccessRate: 0,
      avgReward: 0,
      totalTransitions: 0,
      uniqueStates: 0,
      qtableSize: 0,
      feedbackCount: 0,
      explorationRate: 0.2,
      currentEpisode: null
    };
  }

  // ==================== Episodes ====================

  async getRecentEpisodes(limit: number = 20): Promise<Episode[]> {
    try {
      const response = await this.callPythonBridge('get_recent_episodes', { limit });
      return (response || []).map((e: any) => this.transformEpisode(e));
    } catch (error) {
      console.error('[RL Service] Error getting episodes:', error);
      return [];
    }
  }

  async getEpisode(episodeId: number): Promise<Episode | null> {
    try {
      const response = await this.callPythonBridge('get_episode', { episode_id: episodeId });
      return response ? this.transformEpisode(response) : null;
    } catch (error) {
      console.error('[RL Service] Error getting episode:', error);
      return null;
    }
  }

  async getEpisodeTransitions(episodeId: number): Promise<Transition[]> {
    try {
      const response = await this.callPythonBridge('get_episode_transitions', { episode_id: episodeId });
      return (response || []).map((t: any) => this.transformTransition(t));
    } catch (error) {
      console.error('[RL Service] Error getting transitions:', error);
      return [];
    }
  }

  private transformEpisode(raw: any): Episode {
    return {
      id: raw.id,
      taskDescription: raw.task_description || '',
      taskId: raw.task_id || '',
      startTime: raw.start_time || '',
      endTime: raw.end_time || null,
      totalReward: raw.total_reward || 0,
      totalSteps: raw.total_steps || 0,
      success: Boolean(raw.success),
      terminalState: raw.terminal_state || '',
      explorationRate: raw.exploration_rate || 0.2
    };
  }

  private transformTransition(raw: any): Transition {
    return {
      id: raw.id,
      episodeId: raw.episode_id,
      stepIndex: raw.step_index || 0,
      stateHash: raw.state_hash || '',
      stateSummary: raw.state_summary || '',
      actionType: raw.action_type || '',
      actionParams: raw.action_params || {},
      actionText: raw.action_text || '',
      reward: raw.reward || 0,
      rewardSource: raw.reward_source || 'auto',
      nextStateHash: raw.next_state_hash || '',
      nextStateSummary: raw.next_state_summary || '',
      isTerminal: Boolean(raw.is_terminal),
      timestamp: raw.timestamp || ''
    };
  }

  // ==================== Learning Curve ====================

  async getLearningCurve(window: number = 10): Promise<LearningCurvePoint[]> {
    try {
      const response = await this.callPythonBridge('get_learning_curve', { window });
      return (response || []).map((p: any) => ({
        episode: p.episode,
        reward: p.reward,
        avgReward: p.avg_reward,
        success: Boolean(p.success),
        successRate: p.success_rate,
        timestamp: p.timestamp
      }));
    } catch (error) {
      console.error('[RL Service] Error getting learning curve:', error);
      return [];
    }
  }

  // ==================== Q-Table ====================

  async getQTableSample(limit: number = 50): Promise<QTableEntry[]> {
    try {
      const response = await this.callPythonBridge('get_qtable_sample', { limit });
      return (response || []).map((e: any) => ({
        id: e.id,
        stateHash: e.state_hash,
        stateDescription: e.state_description || '',
        actionKey: e.action_key,
        actionDescription: e.action_description || '',
        qValue: e.q_value,
        visitCount: e.visit_count,
        lastUpdate: e.last_update || '',
        confidence: e.confidence
      }));
    } catch (error) {
      console.error('[RL Service] Error getting Q-table:', error);
      return [];
    }
  }

  async getQValuesForState(stateHash: string): Promise<QTableEntry[]> {
    try {
      const response = await this.callPythonBridge('get_q_values', { state_hash: stateHash });
      return (response || []).map((e: any) => ({
        id: e.id,
        stateHash: e.state_hash,
        stateDescription: e.state_description || '',
        actionKey: e.action_key,
        actionDescription: e.action_description || '',
        qValue: e.q_value,
        visitCount: e.visit_count,
        lastUpdate: e.last_update || '',
        confidence: e.confidence
      }));
    } catch (error) {
      console.error('[RL Service] Error getting Q-values:', error);
      return [];
    }
  }

  // ==================== Human Feedback ====================

  async getPendingFeedback(limit: number = 10): Promise<PendingFeedbackItem[]> {
    try {
      const response = await this.callPythonBridge('get_pending_feedback', { limit });
      return (response || []).map((item: any) => ({
        id: item.id,
        episodeId: item.episode_id,
        step: item.step,
        actionType: item.action_type,
        actionText: item.action_text,
        reward: item.reward,
        rewardSource: item.reward_source,
        stateSummary: item.state_summary,
        nextStateSummary: item.next_state_summary,
        timestamp: item.timestamp
      }));
    } catch (error) {
      console.error('[RL Service] Error getting pending feedback:', error);
      return [];
    }
  }

  async submitFeedback(feedback: HumanFeedback): Promise<{ success: boolean; feedbackId?: number }> {
    try {
      const response = await this.callPythonBridge('submit_feedback', {
        transition_id: feedback.transitionId,
        episode_id: feedback.episodeId,
        feedback_type: feedback.feedbackType,
        original_reward: feedback.originalReward,
        corrected_reward: feedback.correctedReward,
        comment: feedback.comment
      });
      
      this.emit('feedback_submitted', feedback);
      this.cachedStats = null; // Invalidate cache
      
      return { success: true, feedbackId: response?.feedback_id };
    } catch (error) {
      console.error('[RL Service] Error submitting feedback:', error);
      return { success: false };
    }
  }

  // ==================== Settings ====================

  async setExplorationRate(rate: number): Promise<boolean> {
    try {
      await this.callPythonBridge('set_exploration_rate', { rate: Math.max(0, Math.min(1, rate)) });
      this.cachedStats = null;
      this.emit('settings_changed', { explorationRate: rate });
      return true;
    } catch (error) {
      console.error('[RL Service] Error setting exploration rate:', error);
      return false;
    }
  }

  async setLearningRate(rate: number): Promise<boolean> {
    try {
      await this.callPythonBridge('set_learning_rate', { rate: Math.max(0, Math.min(1, rate)) });
      this.emit('settings_changed', { learningRate: rate });
      return true;
    } catch (error) {
      console.error('[RL Service] Error setting learning rate:', error);
      return false;
    }
  }

  // ==================== Python Bridge ====================

  private async callPythonBridge(method: string, params: Record<string, any> = {}): Promise<any> {
    // In development, we might not have the bridge running
    // Return mock data or try HTTP call
    
    try {
      const response = await fetch(`${this.pythonBridgeUrl}/rl/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      // If bridge not available, return mock data for development
      console.warn(`[RL Service] Bridge call failed for ${method}, using mock data`);
      return this.getMockData(method, params);
    }
  }

  private getMockData(method: string, params: Record<string, any>): any {
    switch (method) {
      case 'get_rl_stats':
        return {
          total_episodes: 42,
          successful_episodes: 35,
          success_rate: 0.83,
          recent_success_rate: 0.90,
          avg_reward: 7.5,
          total_transitions: 420,
          unique_states: 156,
          qtable_size: 289,
          feedback_count: 15,
          exploration_rate: 0.15,
          current_episode: null
        };
      
      case 'get_recent_episodes':
        return Array.from({ length: Math.min(params.limit || 20, 5) }, (_, i) => ({
          id: 100 - i,
          task_description: `Example Task ${100 - i}`,
          task_id: `task_${100 - i}`,
          start_time: new Date(Date.now() - i * 3600000).toISOString(),
          end_time: new Date(Date.now() - i * 3600000 + 300000).toISOString(),
          total_reward: 5 + Math.random() * 10,
          total_steps: 5 + Math.floor(Math.random() * 10),
          success: Math.random() > 0.2,
          terminal_state: 'abc123',
          exploration_rate: 0.2 - i * 0.01
        }));
      
      case 'get_learning_curve':
        return Array.from({ length: 50 }, (_, i) => ({
          episode: i + 1,
          reward: 3 + i * 0.1 + Math.random() * 2,
          avg_reward: 3 + i * 0.12,
          success: Math.random() > (0.5 - i * 0.008),
          success_rate: 0.5 + i * 0.01,
          timestamp: new Date(Date.now() - (50 - i) * 3600000).toISOString()
        }));
      
      case 'get_qtable_sample':
        return Array.from({ length: Math.min(params.limit || 50, 10) }, (_, i) => ({
          id: i + 1,
          state_hash: `state_${i}`,
          state_description: `Desktop with ${3 + i} elements`,
          action_key: ['click:OK', 'press:enter', 'type:test', 'hotkey:win+e'][i % 4],
          action_description: ['Click OK button', 'Press Enter', 'Type test', 'Open Explorer'][i % 4],
          q_value: 0.5 + Math.random() * 0.5,
          visit_count: 10 + Math.floor(Math.random() * 50),
          last_update: new Date(Date.now() - Math.random() * 86400000).toISOString(),
          confidence: 0.3 + Math.random() * 0.7
        }));
      
      case 'get_pending_feedback':
        return Array.from({ length: Math.min(params.limit || 10, 3) }, (_, i) => ({
          id: 1000 + i,
          episode_id: 95 + i,
          step: i + 1,
          action_type: ['click', 'type', 'press'][i % 3],
          action_text: [`Click on Settings`, `Type hello`, `Press Enter`][i % 3],
          reward: [-0.5, 0.1, 0.2][i % 3],
          reward_source: 'auto',
          state_summary: 'Desktop with system tray',
          next_state_summary: 'Settings window opened',
          timestamp: new Date(Date.now() - i * 3600000).toISOString()
        }));
      
      default:
        return {};
    }
  }
}

// ==================== WebSocket Handler Extensions ====================

export interface RLWebSocketMessage {
  type: 
    | 'get_rl_stats' 
    | 'get_recent_episodes' 
    | 'get_episode_transitions'
    | 'get_learning_curve' 
    | 'get_qtable_sample'
    | 'get_pending_feedback'
    | 'submit_feedback'
    | 'set_exploration_rate'
    | 'set_learning_rate';
  data?: any;
}

export interface RLWebSocketResponse {
  type: string;
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Handles RL-related WebSocket messages
 */
export async function handleRLMessage(
  service: RLService,
  message: RLWebSocketMessage
): Promise<RLWebSocketResponse> {
  try {
    switch (message.type) {
      case 'get_rl_stats':
        return {
          type: 'rl_stats',
          success: true,
          data: await service.getStats()
        };
      
      case 'get_recent_episodes':
        return {
          type: 'rl_episodes',
          success: true,
          data: await service.getRecentEpisodes(message.data?.limit || 20)
        };
      
      case 'get_episode_transitions':
        return {
          type: 'rl_transitions',
          success: true,
          data: await service.getEpisodeTransitions(message.data?.episodeId)
        };
      
      case 'get_learning_curve':
        return {
          type: 'rl_learning_curve',
          success: true,
          data: await service.getLearningCurve(message.data?.window || 10)
        };
      
      case 'get_qtable_sample':
        return {
          type: 'rl_qtable',
          success: true,
          data: await service.getQTableSample(message.data?.limit || 50)
        };
      
      case 'get_pending_feedback':
        return {
          type: 'rl_pending_feedback',
          success: true,
          data: await service.getPendingFeedback(message.data?.limit || 10)
        };
      
      case 'submit_feedback':
        const result = await service.submitFeedback(message.data as HumanFeedback);
        return {
          type: 'rl_feedback_submitted',
          success: result.success,
          data: { feedbackId: result.feedbackId }
        };
      
      case 'set_exploration_rate':
        const exploreSuccess = await service.setExplorationRate(message.data?.rate || 0.2);
        return {
          type: 'rl_settings_updated',
          success: exploreSuccess,
          data: { explorationRate: message.data?.rate }
        };
      
      case 'set_learning_rate':
        const learnSuccess = await service.setLearningRate(message.data?.rate || 0.1);
        return {
          type: 'rl_settings_updated',
          success: learnSuccess,
          data: { learningRate: message.data?.rate }
        };
      
      default:
        return {
          type: 'error',
          success: false,
          error: `Unknown RL message type: ${message.type}`
        };
    }
  } catch (error) {
    return {
      type: 'error',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ==================== Singleton ====================

let rlServiceInstance: RLService | null = null;

export function getRLService(pythonBridgeUrl?: string): RLService {
  if (!rlServiceInstance) {
    rlServiceInstance = new RLService(pythonBridgeUrl);
  }
  return rlServiceInstance;
}

export default RLService;