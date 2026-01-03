/**
 * Classifiers Module
 * 
 * Provides text and icon classification utilities.
 */

// Text Classifier
export { TextClassifier, createTextClassifier } from './text-classifier';

// pHash Icon Classifier
export {
  IconClassifier,
  createIconClassifier,
  calculatePHash,
  calculateDHash,
  hammingDistance,
} from './icon-classifier';

// CNN Icon Classifier
export {
  CNNIconClassifier,
  HybridIconClassifier,
  createCNNIconClassifier,
  createHybridIconClassifier,
  createIconCNNModel,
  ICON_CATEGORIES,
} from './cnn-icon-classifier';

export type {
  IconClassificationResult,
  CNNClassifierConfig,
  TrainingData,
} from './cnn-icon-classifier';

// LLM-Guided Trainer (RLAF)
export {
  LLMGuidedTrainer,
  AutoTrainingPipeline,
  OpenRouterIconAnalyzer,
} from './llm-guided-trainer';

// Learning DataFrame (Dynamic Categories)
export {
  LearningDataFrame,
  createLearningDataFrame,
  BASE_ICON_CATEGORIES,
} from './learning-dataframe';

export type {
  LearningRecord,
  CategoryStats,
  DataFrameExport,
  BaseIconCategory,
} from './learning-dataframe';

// Continuous Learner
export {
  ContinuousLearner,
  createContinuousLearner,
} from './continuous-learner';

export type {
  ContinuousLearnerConfig,
  LearningStats,
  DetectedIcon,
  ClassificationWithFeedback,
  LearnerEvent,
} from './continuous-learner';