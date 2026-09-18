/**
 * The app's two recurring controls, on Base UI primitives.
 *
 * Both of these existed before as hand-rolled markup — a row of buttons with
 * `role="radio"` set by hand, and a checkbox in a label. They behaved almost
 * correctly. What they did not have was arrow-key navigation within the group,
 * roving focus, or the pressed/disabled state wiring that assistive technology
 * reads; Base UI brings those, and leaves the styling entirely to us.
 */

import type { ReactNode } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Tooltip } from '@base-ui/react/tooltip';

export interface Choice<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * Pick exactly one of a handful of options — the seat count, the clock, the
 * board, the piece set. Always one answer, never none.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      className={`choices ${className}`.trim()}
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        // Pressing the option that is already on yields an empty group. A
        // choice group always has exactly one answer, so that is a no-op
        // rather than a deselection.
        const picked = next[0] as T | undefined;
        if (picked && picked !== value) onChange(picked);
      }}
    >
      {options.map((option) => (
        <Toggle key={option.id} value={option.id} className="choice">
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** An on/off preference — move sounds, flipping the board. */
export function ToggleSwitch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="switch-field">
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
      <span>{children}</span>
    </label>
  );
}

/**
 * A hint attached to something small and wordless. `title` did this before, at
 * the mercy of the browser's own half-second-to-two-second delay and with no
 * way to style or position it.
 */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      {/* A span, not a button: these anchors sit inside other controls, and a
          nested button would be invalid markup and a second tab stop. */}
      <Tooltip.Trigger render={<span className="hint-anchor" />}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="tooltip">
            <Tooltip.Arrow className="tooltip-arrow" />
            {text}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
