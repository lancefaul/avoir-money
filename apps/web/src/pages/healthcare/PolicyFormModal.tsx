import { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateInsurancePolicySchema } from '@budget-tracker/core';
import type {
  CreateInsurancePolicy,
  UpdateInsurancePolicy,
  InsurancePolicyWithBalance,
  PolicyType,
} from '@budget-tracker/core';
import {
  Modal,
  Select,
  CurrencyInput,
  DatePicker,
  toPickerDate,
  fromPickerDate,
  IntegerInput,
  buttonStyles,
  inputStyles,
  vars,
} from '@budget-tracker/ui';
import FieldError from '../../components/FieldError.js';
import {
  type CreateFormValues,
  currentYear,
  CreateFormSchema,
  defaultMetadata,
  TYPE_OPTIONS,
  extractMetadata,
  buildMetadataPayload,
} from './policyFormSchema.js';

interface PolicyFormModalProps {
  open: boolean;
  onClose: () => void;
  policy?: InsurancePolicyWithBalance;
  defaultType?: PolicyType;
  onSubmit: (data: CreateInsurancePolicy | UpdateInsurancePolicy) => Promise<void>;
}

export default function PolicyFormModal({
  open,
  onClose,
  policy,
  defaultType = 'MEDICAL',
  onSubmit,
}: PolicyFormModalProps) {
  const fid = useId();
  const isEdit = !!policy;
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevPolicy, setPrevPolicy] = useState(policy);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(isEdit ? UpdateInsurancePolicySchema : CreateFormSchema),
    defaultValues: policy
      ? {
          type: policy.type as PolicyType,
          year: policy.year,
          employer: policy.employer,
          premium: policy.premium,
          deductibleLimit: policy.deductibleLimit,
          oopmLimit: policy.oopmLimit,
          metadata: extractMetadata(policy),
        }
      : {
          type: defaultType,
          year: currentYear,
          employer: '',
          premium: 0,
          deductibleLimit: null,
          oopmLimit: null,
          metadata: { ...defaultMetadata },
        },
  });

  const watchedType = watch('type');
  const isMedical = watchedType === 'MEDICAL';

  // Reset form when modal opens or policy changes
  if (open && (!prevOpen || policy !== prevPolicy)) {
    setPrevOpen(true);
    setPrevPolicy(policy);
    setApiError('');
    reset(
      policy
        ? {
            type: policy.type as PolicyType,
            year: policy.year,
            employer: policy.employer,
            premium: policy.premium,
            deductibleLimit: policy.deductibleLimit,
            oopmLimit: policy.oopmLimit,
            metadata: extractMetadata(policy),
          }
        : {
            type: defaultType,
            year: currentYear,
            employer: '',
            premium: 0,
            deductibleLimit: null,
            oopmLimit: null,
            metadata: { ...defaultMetadata },
          },
    );
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  async function doSubmit(values: CreateFormValues) {
    setApiError('');
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        deductibleLimit: values.deductibleLimit ?? undefined,
        oopmLimit: values.oopmLimit ?? undefined,
        metadata: buildMetadataPayload(values, policy?.type as PolicyType | undefined, defaultType),
      };
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { message?: string; error?: string })?.message ||
        (err as { error?: string })?.error ||
        'Something went wrong';
      setApiError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  }

  function onFormSubmit(values: CreateFormValues) {
    doSubmit(values);
  }

  const metaErrors = errors.metadata as Record<string, { message?: string }> | undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Insurance Policy' : 'Add Insurance Policy'}
      variant="drawer"
      closeButton="none"
      footer={
        <div style={{ display: 'flex', gap: vars.space['2'] }}>
          <button
            type="submit"
            form="policy-drawer-form"
            disabled={submitting}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </div>
      }
    >
      {apiError && (
        <p
          style={{
            background: vars.color.danger50,
            color: vars.color.danger600,
            padding: `${vars.space['2']} ${vars.space['3']}`,
            borderRadius: vars.radius.sm,
            fontSize: vars.font.sm,
            marginBottom: vars.space['3'],
          }}
        >
          {apiError}
        </p>
      )}

      <form id="policy-drawer-form" onSubmit={handleSubmit(onFormSubmit)}>
        <div className={inputStyles.formStack}>
          {/* ── Plan Terms ── */}
          <p
            style={{
              fontSize: vars.font.xs,
              fontWeight: vars.font.semibold,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
              color: vars.color.textTertiary,
              margin: 0,
              marginTop: vars.space['2'],
              paddingBottom: vars.space['2'],
              borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
            }}
          >
            Plan Terms
          </p>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-year`} className={inputStyles.fieldLabel}>
              Year
            </label>
            <IntegerInput
              id={`${fid}-year`}
              value={watch('year') ?? 0}
              onChange={(v) => setValue('year', v)}
              min={2000}
              max={2100}
              disabled={isEdit}
              placeholder="2026"
            />
            <FieldError error={errors.year} />
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-premium`} className={inputStyles.fieldLabel}>
              Premium
            </label>
            <CurrencyInput
              id={`${fid}-premium`}
              value={Math.round((watch('premium') ?? 0) * 100)}
              onChange={(v) => setValue('premium', v / 100)}
            />
            <FieldError error={errors.premium} />
          </div>

          <div className={inputStyles.formGrid2}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-deductible`} className={inputStyles.fieldLabel}>
                Deductible Limit{isMedical ? '' : ' (optional)'}
              </label>
              <CurrencyInput
                id={`${fid}-deductible`}
                value={Math.round((watch('deductibleLimit') ?? 0) * 100)}
                onChange={(v) => setValue('deductibleLimit', v ? v / 100 : null)}
              />
              <FieldError error={errors.deductibleLimit} />
            </div>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-oopm`} className={inputStyles.fieldLabel}>
                OOPM Limit{isMedical ? '' : ' (optional)'}
              </label>
              <CurrencyInput
                id={`${fid}-oopm`}
                value={Math.round((watch('oopmLimit') ?? 0) * 100)}
                onChange={(v) => setValue('oopmLimit', v ? v / 100 : null)}
              />
              <FieldError error={errors.oopmLimit} />
            </div>
          </div>

          {/* ── Policy Details ── */}
          <p
            style={{
              fontSize: vars.font.xs,
              fontWeight: vars.font.semibold,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
              color: vars.color.textTertiary,
              margin: 0,
              marginTop: vars.space['2'],
              paddingBottom: vars.space['2'],
              borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
            }}
          >
            Policy Details
          </p>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-type`} className={inputStyles.fieldLabel}>
              Type
            </label>
            <Select
              id={`${fid}-type`}
              options={TYPE_OPTIONS}
              value={watchedType}
              onChange={(v) => setValue('type', v as PolicyType)}
              disabled={isEdit}
            />
            <FieldError error={errors.type} />
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-employer`} className={inputStyles.fieldLabel}>
              Employer
            </label>
            <input id={`${fid}-employer`} className={inputStyles.input} {...register('employer')} />
            <FieldError error={errors.employer} />
          </div>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-insurer`} className={inputStyles.fieldLabel}>
              Insurer <span className={inputStyles.fieldRequired}>*</span>
            </label>
            <input
              id={`${fid}-insurer`}
              className={inputStyles.input}
              {...register('metadata.insurer')}
            />
            <FieldError error={metaErrors?.insurer} />
          </div>

          {isMedical && (
            <>
              <div className={inputStyles.formGrid2}>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-policy-id`} className={inputStyles.fieldLabel}>
                    Policy ID <span className={inputStyles.fieldRequired}>*</span>
                  </label>
                  <input
                    id={`${fid}-policy-id`}
                    className={inputStyles.input}
                    {...register('metadata.policyId')}
                  />
                  <FieldError error={metaErrors?.policyId} />
                </div>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-group-number`} className={inputStyles.fieldLabel}>
                    Group Number <span className={inputStyles.fieldRequired}>*</span>
                  </label>
                  <input
                    id={`${fid}-group-number`}
                    className={inputStyles.input}
                    {...register('metadata.groupNumber')}
                  />
                  <FieldError error={metaErrors?.groupNumber} />
                </div>
              </div>
              <div className={inputStyles.field}>
                <label htmlFor={`${fid}-health-plan`} className={inputStyles.fieldLabel}>
                  Health Plan
                </label>
                <input
                  id={`${fid}-health-plan`}
                  className={inputStyles.input}
                  {...register('metadata.healthPlan')}
                />
              </div>
              <div className={inputStyles.formGrid2}>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-rx-bin`} className={inputStyles.fieldLabel}>
                    Rx BIN
                  </label>
                  <input
                    id={`${fid}-rx-bin`}
                    className={inputStyles.input}
                    {...register('metadata.rxBin')}
                  />
                </div>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-rx-pcn`} className={inputStyles.fieldLabel}>
                    Rx PCN
                  </label>
                  <input
                    id={`${fid}-rx-pcn`}
                    className={inputStyles.input}
                    {...register('metadata.rxPcn')}
                  />
                </div>
              </div>
            </>
          )}

          {watchedType === 'DENTAL' && (
            <>
              <div className={inputStyles.formGrid2}>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-policy-id-d`} className={inputStyles.fieldLabel}>
                    Policy ID
                  </label>
                  <input
                    id={`${fid}-policy-id-d`}
                    className={inputStyles.input}
                    {...register('metadata.policyId')}
                  />
                </div>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-group-name`} className={inputStyles.fieldLabel}>
                    Group Name
                  </label>
                  <input
                    id={`${fid}-group-name`}
                    className={inputStyles.input}
                    {...register('metadata.groupName')}
                  />
                </div>
              </div>
              <div className={inputStyles.formGrid2}>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-group-number-d`} className={inputStyles.fieldLabel}>
                    Group Number
                  </label>
                  <input
                    id={`${fid}-group-number-d`}
                    className={inputStyles.input}
                    {...register('metadata.groupNumber')}
                  />
                </div>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-effective-date`} className={inputStyles.fieldLabel}>
                    Effective Date
                  </label>
                  <DatePicker
                    id={`${fid}-effective-date`}
                    value={toPickerDate(watch('metadata.effectiveDate'))}
                    onChange={(d) => setValue('metadata.effectiveDate', fromPickerDate(d))}
                  />
                </div>
              </div>
            </>
          )}

          {watchedType === 'VISION' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-policy-id-v`} className={inputStyles.fieldLabel}>
                Policy ID
              </label>
              <input
                id={`${fid}-policy-id-v`}
                className={inputStyles.input}
                {...register('metadata.policyId')}
              />
            </div>
          )}

          {/* ── Additional Information ── */}
          <p
            style={{
              fontSize: vars.font.xs,
              fontWeight: vars.font.semibold,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
              color: vars.color.textTertiary,
              margin: 0,
              marginTop: vars.space['2'],
              paddingBottom: vars.space['2'],
              borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
            }}
          >
            Additional Information
          </p>

          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-management-url`} className={inputStyles.fieldLabel}>
              Management URL
            </label>
            <input
              id={`${fid}-management-url`}
              className={inputStyles.input}
              placeholder="https://example.com/manage"
              {...register('metadata.managementUrl')}
            />
            <FieldError error={metaErrors?.managementUrl} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
