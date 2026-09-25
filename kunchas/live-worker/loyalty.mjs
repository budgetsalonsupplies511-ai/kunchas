export const POINTS_PAYMENT = 'Loyalty Points';

export function loyaltyForSale({ customerId, balance = 0, totalCents, payments }) {
  const amount = method => payments.filter(p => p.method === method).reduce((sum, p) => sum + p.amountCents, 0);
  const redeemed = amount(POINTS_PAYMENT); // 100 points = $1, so one point = one cent.
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('The sale total must be a positive amount.');
  if (!Number.isSafeInteger(redeemed) || redeemed < 0) throw new Error('Enter a whole number of loyalty points.');
  if (redeemed && !customerId) throw new Error('Select a customer account to use loyalty points.');
  if (redeemed && redeemed < 500) throw new Error('Use at least 500 points ($5) per redemption.');
  if (redeemed > balance) throw new Error('This customer does not have enough loyalty points. Refresh their balance.');
  if (redeemed > totalCents) throw new Error('Points cannot exceed the sale total or be exchanged for cash.');
  const eligibleCents = Math.max(0, totalCents - redeemed - amount('On Account') - amount('Refund'));
  return { earned: customerId ? Math.floor(eligibleCents / 100) : 0, redeemed };
}

export function loyaltyError(error) {
  if (String(error).includes('LOYALTY_INSUFFICIENT_POINTS')) return 'The points balance changed. Refresh the customer and try again.';
  if (String(error).includes('LOYALTY_POINTS_ALREADY_SPENT')) return 'This edit would remove points the customer has already spent. Adjust the payment or resolve the points balance first.';
  return null;
}
