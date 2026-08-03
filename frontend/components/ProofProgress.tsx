import React from 'react';
import { IconCheck, IconLoader2, IconAlertTriangle } from '@tabler/icons-react';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface ProgressStep {
  label: string;
  status: StepStatus;
  error?: string;
}

export function ProofProgress({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="proof-progress">
      {steps.map((step, idx) => (
        <div key={idx} className={`proof-progress-step status-${step.status}`}>
          <div className="proof-progress-icon">
            {step.status === 'done' && <IconCheck size={13} stroke={3} />}
            {step.status === 'active' && <IconLoader2 size={13} className="spin" />}
            {step.status === 'error' && <IconAlertTriangle size={13} />}
            {step.status === 'pending' && <div className="pending-dot" />}
          </div>
          <div className="proof-progress-content">
            <div className="proof-progress-label">{step.label}</div>
            {step.status === 'error' && step.error && (
              <div className="proof-progress-error">{step.error}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
