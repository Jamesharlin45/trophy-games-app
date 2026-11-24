/**
 * Localised display names for the Google Play subscription products, so both
 * the Store tab and the dialogs can talk about a plan by name.
 */

import { SUBSCRIPTION_PRODUCTS } from '@trophy-games/shared/subscriptions';
import i18n from '../locales';

/** Falls back to the product id when the SKU is not one we know about. */
export function planTitleFor(productId: string): string {
    if (productId === SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId) {
        return i18n.t('market.vipWeeklyTitle');
    }
    if (productId === SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId) {
        return i18n.t('market.vipMonthlyTitle');
    }
    if (productId === SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId) {
        return i18n.t('market.paidMonthlyTitle');
    }
    return productId;
}

export default planTitleFor;
