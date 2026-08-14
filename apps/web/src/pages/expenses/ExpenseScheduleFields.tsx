import {
  ButtonGroup,
  Select,
  type SelectOption,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  Toggle,
  IntegerInput,
  inputStyles,
} from '@budget-tracker/ui';
import type { UseFormWatch, UseFormSetValue, FieldErrors } from 'react-hook-form';
import type { FormValues } from './types.js';
import { WEEKDAYS, ORDINALS } from './types.js';
import FieldError from '../../components/FieldError.js';

interface ExpenseScheduleFieldsProps {
  fid: string;
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;
  dueType: 'day' | 'weekday' | undefined;
  isOngoing: boolean;
  setIsOngoing: (v: boolean) => void;
}

const DUE_TYPE_OPTIONS = [
  { value: 'day', label: 'Day of month' },
  { value: 'weekday', label: 'Nth weekday' },
];

export default function ExpenseScheduleFields({
  fid,
  watch,
  setValue,
  errors,
  dueType,
  isOngoing,
  setIsOngoing,
}: ExpenseScheduleFieldsProps) {
  const ordinalOptions: SelectOption[] = ORDINALS.map((o) => ({
    value: String(o.value),
    label: o.label,
  }));
  const weekdayOptions: SelectOption[] = WEEKDAYS.map((d, i) => ({
    value: String(i),
    label: d,
  }));

  // Form stores "YYYY-MM-DD"; the picker wants a local-midnight Date.
  const startDateObj = toPickerDate(watch('startDate'));
  const endDateObj = toPickerDate(watch('endDate'));

  return (
    <>
      {/* Due Schedule */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-due`} className={inputStyles.fieldLabel}>
          Due Schedule
        </label>
        <ButtonGroup
          id={`${fid}-due`}
          options={DUE_TYPE_OPTIONS}
          value={dueType ?? 'day'}
          onChange={(v) => setValue('dueType', v as 'day' | 'weekday')}
          size="md"
          ariaLabel="Due schedule type"
        />
      </div>
      {dueType === 'day' ? (
        <div className={inputStyles.field}>
          <IntegerInput
            value={watch('dueDay') ?? 0}
            onChange={(v) => setValue('dueDay', v || undefined)}
            min={1}
            max={31}
            placeholder="e.g. 1, 15"
          />
          <FieldError error={errors.dueDay} />
        </div>
      ) : (
        <div className={inputStyles.formGrid2}>
          <div className={inputStyles.field}>
            <Select
              options={ordinalOptions}
              value={watch('dueOrdinal') != null ? String(watch('dueOrdinal')) : ''}
              onChange={(v) => setValue('dueOrdinal', Number(v))}
              placeholder="Which…"
              error={!!errors.dueOrdinal}
            />
            <FieldError error={errors.dueOrdinal} />
          </div>
          <div className={inputStyles.field}>
            <Select
              options={weekdayOptions}
              value={watch('dueWeekday') != null ? String(watch('dueWeekday')) : ''}
              onChange={(v) => setValue('dueWeekday', Number(v))}
              placeholder="Day…"
              error={!!errors.dueWeekday}
            />
            <FieldError error={errors.dueWeekday} />
          </div>
        </div>
      )}

      {/* Start Date */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-start`} className={inputStyles.fieldLabel}>
          Start Date
        </label>
        <DatePicker
          id={`${fid}-start`}
          value={startDateObj}
          onChange={(d) => setValue('startDate', fromPickerDate(d))}
          error={!!errors.startDate}
        />
        <FieldError error={errors.startDate} />
      </div>

      {/* End Date */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-end`} className={inputStyles.fieldLabel}>
          End Date
        </label>
        <Toggle
          checked={isOngoing}
          onChange={(checked) => {
            setIsOngoing(checked);
            if (checked) setValue('endDate', '');
          }}
          label="Ongoing"
        />
        {!isOngoing && (
          <>
            <DatePicker
              value={endDateObj}
              onChange={(d) => setValue('endDate', fromPickerDate(d))}
              error={!!errors.endDate}
            />
            <FieldError error={errors.endDate} />
          </>
        )}
      </div>
    </>
  );
}
