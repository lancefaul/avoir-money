import { useId, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { CreatePayScheduleSchema } from '@budget-tracker/core';
import { addYears } from 'date-fns';
import {
  Select,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  Toggle,
  IntegerInput,
  DisplayHeading,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  usePaySchedules,
  useCreatePaySchedule,
  useUpdatePaySchedule,
  useGeneratePeriods,
} from '../hooks/usePaySchedules.js';
import FieldError from './FieldError.js';

// anchorDate is an ISO date string in the form (DatePicker value); the API's
// z.coerce.date() coerces it on submit. Override the coerced Date type to match.
type FormValues = Omit<z.input<typeof CreatePayScheduleSchema>, 'anchorDate'> & {
  anchorDate: string;
};

const TYPE_OPTIONS = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Biweekly' },
  { value: 'SEMI_MONTHLY', label: 'Semi-Monthly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

/** Extract YYYY-MM-DD from a UTC-midnight date without timezone shift */
function toDateInputValue(d: Date | string): string {
  const iso = typeof d === 'string' ? d : d.toISOString();
  return iso.split('T')[0]!;
}

export default function PayScheduleSettings() {
  const fid = useId();
  const { data: schedules, isLoading } = usePaySchedules();
  const createMutation = useCreatePaySchedule();
  const updateMutation = useUpdatePaySchedule();
  const generateMutation = useGeneratePeriods();

  const existing = schedules?.[0] ?? null;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(CreatePayScheduleSchema),
    mode: 'onBlur',
    defaultValues: existing
      ? {
          name: existing.name,
          type: existing.type as FormValues['type'],
          anchorDate: toDateInputValue(existing.anchorDate),
          firstPayDay: existing.firstPayDay ?? undefined,
          secondPayDay: existing.secondPayDay ?? undefined,
          isDefault: existing.isDefault,
        }
      : { name: 'Primary', type: 'BIWEEKLY' as const, isDefault: true },
  });

  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name,
        type: existing.type as FormValues['type'],
        anchorDate: toDateInputValue(existing.anchorDate),
        firstPayDay: existing.firstPayDay ?? undefined,
        secondPayDay: existing.secondPayDay ?? undefined,
        isDefault: existing.isDefault,
      });
    }
  }, [existing, reset]);

  const scheduleType = watch('type');
  const showAnchor = scheduleType === 'WEEKLY' || scheduleType === 'BIWEEKLY';
  const showFirstPayDay = scheduleType === 'SEMI_MONTHLY' || scheduleType === 'MONTHLY';
  const showSecondPayDay = scheduleType === 'SEMI_MONTHLY';

  async function onSubmit(data: FormValues) {
    const anchorStr = String(data.anchorDate);
    const anchorISO = anchorStr.includes('T') ? anchorStr : `${anchorStr}T12:00:00`;
    const body = {
      ...data,
      anchorDate: new Date(anchorISO).toISOString(),
      firstPayDay: showFirstPayDay ? data.firstPayDay : undefined,
      secondPayDay: showSecondPayDay ? data.secondPayDay : undefined,
    };

    let scheduleId: string;
    if (existing) {
      const updated = await updateMutation.mutateAsync({ id: existing.id, body });
      scheduleId = (updated as { id: string }).id;
    } else {
      const created = await createMutation.mutateAsync(body);
      scheduleId = (created as { id: string }).id;
    }

    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), 0, 1);
    const rangeEnd = addYears(now, 2);
    await generateMutation.mutateAsync({
      id: scheduleId,
      body: { rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() },
    });
  }

  const saving = createMutation.isPending || updateMutation.isPending || generateMutation.isPending;

  if (isLoading) {
    return (
      <div>
        <p style={{ color: vars.color.textSecondary, fontSize: vars.font.sm }}>
          Loading pay schedule…
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      <DisplayHeading size="sm" as="h1">
        Pay Schedule
      </DisplayHeading>

      <p
        style={{
          fontSize: vars.font.base,
          color: vars.color.textSecondary,
          margin: 0,
        }}
      >
        {existing
          ? 'Your pay schedule determines how pay periods are generated.'
          : 'Set up your pay schedule to enable pay period tracking.'}
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}
      >
        {/* Name */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
            Name
          </label>
          <input
            id={`${fid}-name`}
            {...register('name')}
            className={inputStyles.input}
            placeholder="Primary"
          />
          <FieldError error={errors.name} />
        </div>

        {/* Type */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-type`} className={inputStyles.fieldLabel}>
            Type
          </label>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Select
                id={`${fid}-type`}
                options={TYPE_OPTIONS}
                value={field.value}
                onChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  if (val) field.onChange(val);
                }}
                aria-label="Pay schedule type"
              />
            )}
          />
          <FieldError error={errors.type} />
        </div>

        {/* Anchor Date */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-anchor`} className={inputStyles.fieldLabel}>
            {showAnchor ? 'Anchor Date' : 'Reference Date'}
          </label>
          <Controller
            name="anchorDate"
            control={control}
            render={({ field }) => {
              const dateValue = toPickerDate(field.value ? String(field.value) : null);
              return (
                <DatePicker
                  id={`${fid}-anchor`}
                  value={dateValue}
                  onChange={(d) => field.onChange(d ? fromPickerDate(d) : undefined)}
                />
              );
            }}
          />
          <FieldError error={errors.anchorDate} />
        </div>

        {/* First Pay Day */}
        {showFirstPayDay && (
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-first-pay-day`} className={inputStyles.fieldLabel}>
              First Pay Day (1–31)
            </label>
            <IntegerInput
              id={`${fid}-first-pay-day`}
              value={watch('firstPayDay') ?? 0}
              onChange={(v) => setValue('firstPayDay', v || undefined)}
              min={1}
              max={31}
              placeholder="1"
            />
            <FieldError error={errors.firstPayDay} />
          </div>
        )}

        {/* Second Pay Day */}
        {showSecondPayDay && (
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-second-pay-day`} className={inputStyles.fieldLabel}>
              Second Pay Day (1–31)
            </label>
            <IntegerInput
              id={`${fid}-second-pay-day`}
              value={watch('secondPayDay') ?? 0}
              onChange={(v) => setValue('secondPayDay', v || undefined)}
              min={1}
              max={31}
              placeholder="15"
            />
            <FieldError error={errors.secondPayDay} />
          </div>
        )}

        {/* Default toggle */}
        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Default Schedule</label>
          <Controller
            name="isDefault"
            control={control}
            render={({ field }) => (
              <Toggle
                id={`${fid}-default`}
                label="Set this as the default schedule"
                checked={field.value ?? false}
                onChange={field.onChange}
              />
            )}
          />
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: vars.space['3'],
            paddingTop: vars.space['1'],
          }}
        >
          <button
            type="submit"
            disabled={saving}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {saving ? 'Saving…' : existing ? 'Update Schedule' : 'Create Schedule'}
          </button>
        </div>
      </form>
    </div>
  );
}
