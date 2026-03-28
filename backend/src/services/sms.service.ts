import { format } from 'date-fns';

export async function sendSMS(to: string | string[], message: string): Promise<void> {
  const phones = Array.isArray(to) ? to.join(', ') : to;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SMS] To: ${phones}\n[SMS] ${message}\n`);
    return;
  }
  const AT = require('africastalking')({
    username: process.env.AT_USERNAME,
    apiKey: process.env.AT_API_KEY,
  });
  await AT.SMS.send({ to: Array.isArray(to) ? to : [to], message, from: 'GYMMIND' });
}

export function formatCheckinTime(): string {
  return format(new Date(), 'dd MMM yyyy, HH:mm');
}

export async function sendCheckinSMS(
  memberPhone: string,
  memberName: string,
  gymName: string,
  planName: string,
  checkinType: string,
  remainingSessions?: number | null,
  endDate?: string | null,
  managerPhone?: string | null,
  serviceName?: string | null,
): Promise<void> {
  const time = formatCheckinTime();
  const remaining = remainingSessions != null
    ? `${remainingSessions} sessions remaining`
    : endDate
    ? `${Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000))} days remaining`
    : 'Corporate access';
  const serviceLine = serviceName ? `\nService: ${serviceName}` : '';
  const memberMsg = `GymMind: Hi ${memberName}! You checked in at ${gymName}.${serviceLine}\nPlan: ${planName} — ${remaining}.\n${time}`;
  const managerMsg = `GymMind Alert — ${gymName}\n${memberName} (${memberPhone}) checked in.${serviceLine}\nPlan: ${planName} | ${remaining}\n${time}`;
  const sends: Promise<void>[] = [sendSMS(memberPhone, memberMsg)];
  if (managerPhone) sends.push(sendSMS(managerPhone, managerMsg));
  await Promise.allSettled(sends);
}

export async function sendPaymentMemberSMS(params: {
  memberPhone: string,
  memberName: string,
  gymName: string,
  planName: string,
  amount: number,
  startDate: string,
  endDate?: string | null,
  remainingSessions?: number | null,
}): Promise<void> {
  const validity = params.remainingSessions != null
    ? `Sessions: ${params.remainingSessions}`
    : `Valid: ${params.startDate} → ${params.endDate}`;

  const msg = `GymMind: Payment confirmed!\n${params.amount.toLocaleString()} RWF received for ${params.planName} at ${params.gymName}.\nMembership is now ACTIVE.\n${validity}\nYou can now check in. Welcome!`;

  await sendSMS(params.memberPhone, msg);
}

export async function sendPaymentManagerSMS(params: {
  managerPhone: string,
  memberName: string,
  memberPhone: string,
  gymName: string,
  planName: string,
  amount: number,
  transactionId: string,
}): Promise<void> {
  const msg = `GymMind: New payment — ${params.gymName}\n${params.memberName} (${params.memberPhone}) paid ${params.amount.toLocaleString()} RWF.\nPlan: ${params.planName}\nTransaction: ${params.transactionId}\nMembership activated automatically.`;

  await sendSMS(params.managerPhone, msg);
}

export async function sendWalkInMemberSMS(params: {
  memberPhone: string;
  gymName: string;
  serviceNames: string[];
  totalAmount: number;
}): Promise<void> {
  const datetime = format(new Date(), 'dd MMM yyyy · HH:mm');
  const services = params.serviceNames.length > 0 ? params.serviceNames.join(', ') : 'General access';
  const msg = `GymMind: Payment confirmed!\n${params.totalAmount.toLocaleString()} RWF received at ${params.gymName}.\nServices: ${services}\n${datetime}\nEnjoy your session!`;
  await sendSMS(params.memberPhone, msg);
}

export async function sendWalkInManagerSMS(params: {
  managerPhone: string;
  gymName: string;
  serviceNames: string[];
  totalAmount: number;
  payerPhone: string;
  referenceId: string;
}): Promise<void> {
  const datetime = format(new Date(), 'dd MMM yyyy · HH:mm');
  const services = params.serviceNames.length > 0 ? params.serviceNames.join(', ') : 'General access';
  const msg = `GymMind: Walk-in payment — ${params.gymName}\nPhone: ${params.payerPhone}\nServices: ${services}\nAmount: ${params.totalAmount.toLocaleString()} RWF\n${datetime}`;
  await sendSMS(params.managerPhone, msg);
}

export async function sendApprovalSMS(
  memberPhone: string,
  memberName: string,
  gymName: string,
  planName: string,
  startDate: string,
  endDate?: string | null,
  remainingSessions?: number | null,
): Promise<void> {
  const detail = remainingSessions != null
    ? `Sessions: ${remainingSessions}`
    : `Valid until: ${endDate}`;
  const msg = `GymMind: Great news ${memberName}!\nYour ${planName} membership at ${gymName} is now active.\nStart: ${startDate}\n${detail}\nWelcome!`;
  await sendSMS(memberPhone, msg);
}
