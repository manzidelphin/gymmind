import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL     = process.env.MTN_MOMO_BASE_URL;
const SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
const API_USER_ID  = process.env.MTN_MOMO_API_USER_ID;
const API_KEY      = process.env.MTN_MOMO_API_KEY;
const ENVIRONMENT  = process.env.MTN_MOMO_ENVIRONMENT || 'sandbox';

// ── Get OAuth access token ─────────────────────────────────────
async function getAccessToken(
  subscriptionKey: string,
  apiUserId: string,
  apiKey: string,
): Promise<string> {
  const credentials = Buffer.from(`${apiUserId}:${apiKey}`).toString('base64');
  const response = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
      },
    },
  );
  return response.data.access_token;
}

// ── Request payment from member ────────────────────────────────
export async function requestPayment(params: {
  amount: number;
  currency: string;
  payerPhone: string;
  referenceId: string;
  description: string;
  gymSubscriptionKey?: string;
  gymApiUserId?: string;
  gymApiKey?: string;
}): Promise<string> {
  // Use gym's own keys if provided, otherwise fall back to platform keys
  const subKey  = params.gymSubscriptionKey || SUBSCRIPTION_KEY!;
  const userId  = params.gymApiUserId       || API_USER_ID!;
  const apiKey  = params.gymApiKey          || API_KEY!;

  const token       = await getAccessToken(subKey, userId, apiKey);
  const referenceId = params.referenceId || uuidv4();

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount:      params.amount.toString(),
      currency:    ENVIRONMENT === 'sandbox' ? 'EUR' : params.currency,
      externalId:  referenceId,
      payer: {
        partyIdType: 'MSISDN',
        partyId:     params.payerPhone.replace('+', ''),
      },
      payerMessage: params.description,
      payeeNote:    params.description,
    },
    {
      headers: {
        'Authorization':              `Bearer ${token}`,
        'X-Reference-Id':             referenceId,
        'X-Target-Environment':       ENVIRONMENT,
        'Ocp-Apim-Subscription-Key':  subKey,
        'Content-Type':               'application/json',
      },
    },
  );
  return referenceId;
}

// ── Check payment status ───────────────────────────────────────
export async function getPaymentStatus(params: {
  referenceId: string;
  gymSubscriptionKey?: string;
  gymApiUserId?: string;
  gymApiKey?: string;
}): Promise<'SUCCESSFUL' | 'FAILED' | 'PENDING'> {
  const subKey = params.gymSubscriptionKey || SUBSCRIPTION_KEY!;
  const userId = params.gymApiUserId       || API_USER_ID!;
  const apiKey = params.gymApiKey          || API_KEY!;

  const token = await getAccessToken(subKey, userId, apiKey);

  const response = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${params.referenceId}`,
    {
      headers: {
        'Authorization':             `Bearer ${token}`,
        'X-Target-Environment':      ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': subKey,
      },
    },
  );
  return response.data.status;
}
