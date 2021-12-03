import braintree, { GooglePayment } from 'braintree-web';
import {
  addPaymentMethod,
  makePayment,
} from '@linode/api-v4/lib/account/payments';
import { APIWarning } from '@linode/api-v4/lib/types';
import { VariantType } from 'notistack';
import { queryClient } from 'src/queries/base';
import { queryKey as accountPaymentKey } from 'src/queries/accountPayment';
import { queryKey as accountBillingKey } from 'src/queries/accountBilling';
import { GPAY_CLIENT_ENV, GPAY_MERCHANT_ID } from 'src/constants';
import { reportException } from 'src/exceptionReporting';

const merchantInfo: google.payments.api.MerchantInfo = {
  merchantId: GPAY_MERCHANT_ID || '',
  merchantName: 'Linode',
};

let googlePaymentInstance: GooglePayment;

const onPaymentAuthorized = (
  paymentData: google.payments.api.PaymentData
): Promise<any> => {
  return new Promise((resolve, reject) => {
    resolve({ transactionState: 'SUCCESS' });
  });
};

export const initGooglePaymentInstance = async (
  client_token: string
): Promise<{ error: boolean }> => {
  try {
    const braintreeClientToken = await braintree.client.create({
      authorization: client_token,
    });

    googlePaymentInstance = await braintree.googlePayment.create({
      client: braintreeClientToken,
      googlePayVersion: 2,
      googleMerchantId: GPAY_MERCHANT_ID,
    });
  } catch (error) {
    reportException(error, {
      message: 'Error initializing Google Pay.',
    });
    return { error: true };
  }
  return { error: false };
};

const tokenizePaymentDataRequest = async (
  transactionInfo: Omit<google.payments.api.TransactionInfo, 'totalPrice'> & {
    totalPrice?: string;
  }
) => {
  let paymentDataRequest: google.payments.api.PaymentDataRequest;
  try {
    paymentDataRequest = await googlePaymentInstance.createPaymentDataRequest({
      merchantInfo,
      // @ts-expect-error Braintree types are wrong
      transactionInfo,
      callbackIntents: ['PAYMENT_AUTHORIZATION'],
    });
  } catch (error) {
    reportException(error, {
      message: 'Unable to open Google Pay.',
    });
    return Promise.reject('Unable to open Google Pay.');
  }

  const googlePayClient = new google.payments.api.PaymentsClient({
    environment: GPAY_CLIENT_ENV as google.payments.api.Environment,
    merchantInfo,
    paymentDataCallbacks: {
      onPaymentAuthorized,
    },
  });
  const isReadyToPay = await googlePayClient.isReadyToPay({
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: paymentDataRequest.allowedPaymentMethods,
  });
  if (!isReadyToPay) {
    return Promise.reject('Your device does not support Google Pay.');
  }

  const paymentData = await googlePayClient.loadPaymentData(paymentDataRequest);

  const { nonce: realNonce } = await googlePaymentInstance.parseResponse(
    paymentData
  );

  // Use the real nonce (real money) when the Google Merchant ID is provided and
  // the Google Pay environment is set to production.
  const nonce =
    Boolean(GPAY_MERCHANT_ID) && GPAY_CLIENT_ENV === 'PRODUCTION'
      ? realNonce
      : 'fake-android-pay-nonce';
  return Promise.resolve(nonce);
};

export const gPay = async (
  action: 'one-time-payment' | 'add-recurring-payment',
  transactionInfo: Omit<google.payments.api.TransactionInfo, 'totalPrice'> & {
    totalPrice?: string;
  },
  setMessage: (
    message: string,
    variant: VariantType,
    warnings?: APIWarning[]
  ) => void,
  setProcessing: (processing: boolean) => void
) => {
  const makeOneTimePayment = async (nonce: string) => {
    try {
      const response = await makePayment({
        nonce,
        usd: transactionInfo.totalPrice as string,
      });
      queryClient.invalidateQueries(`${accountBillingKey}-payments`);
      setMessage(
        `Payment for $${transactionInfo.totalPrice} successfully submitted with Google Pay`,
        'success',
        response.warnings
      );
    } catch (error) {
      reportException(error, {
        message: 'Unable to complete Google Pay payment',
      });
      setMessage('Unable to complete Google Pay payment', 'error');
    }
  };

  const addRecurringPayment = async (nonce: string) => {
    try {
      await addPaymentMethod({
        type: 'payment_method_nonce',
        data: { nonce },
        is_default: true,
      });
      queryClient.invalidateQueries(`${accountPaymentKey}-all`);
      setMessage('Successfully added Google Pay', 'success');
    } catch (error) {
      reportException(error, {
        message: 'Unable to add payment method',
      });
      // @TODO Consider checking if error is an APIError so we can provide a more descriptive error message.
      setMessage('Unable to add payment method', 'error');
    }
  };

  try {
    const nonce = await tokenizePaymentDataRequest(transactionInfo);
    setProcessing(true);
    if (action === 'one-time-payment') {
      await makeOneTimePayment(nonce);
    } else {
      await addRecurringPayment(nonce);
    }
    setProcessing(false);
  } catch (error) {
    if (error.statusCode === 'CANCELED') {
      return;
    }
    // errorMsg from tokenizePaymentDataRequest
    setMessage(error, 'error');
  }
};
