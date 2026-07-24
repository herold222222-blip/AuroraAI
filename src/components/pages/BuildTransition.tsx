import { ProgressView } from './ProgressView';
import { BUILD_TIPS } from '../../data/tips';

export function BuildTransition() {
  return (
    <ProgressView
      title="正在创建你的模型……"
      tips={BUILD_TIPS}
      duration={3600}
    />
  );
}
