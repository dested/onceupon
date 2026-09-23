import type { RouteObject } from 'react-router-dom'
import { HomePage } from './home'
import { HowPage } from './how'
import { PricingPage } from './pricing'
import { ShopPage } from './shop'
import { ShopThanksPage } from './shop-thanks'
import { GiftPage } from './gift'
import { GiftThanksPage } from './gift-thanks'
import { RedeemPage } from './redeem'
import { FaqPage } from './faq'
import { SupportPage } from './support'
import { TermsPage } from './terms'
import { PrivacyPage } from './privacy'
import { DeleteDataPage } from './delete-data'
import { SharePage, shareLoader } from './share'

/** Public website routes (children of the root Layout). */
export const siteRoutes: RouteObject[] = [
  { index: true, Component: HomePage },
  { path: 'how-it-works', Component: HowPage },
  { path: 'pricing', Component: PricingPage },
  { path: 'shop', Component: ShopPage },
  { path: 'shop/thanks', Component: ShopThanksPage },
  { path: 'gift', Component: GiftPage },
  { path: 'gift/thanks', Component: GiftThanksPage },
  { path: 'redeem', Component: RedeemPage },
  { path: 'faq', Component: FaqPage },
  { path: 'support', Component: SupportPage },
  { path: 'terms', Component: TermsPage },
  { path: 'privacy', Component: PrivacyPage },
  { path: 'delete-my-data', Component: DeleteDataPage },
  { path: 's/:id', Component: SharePage, loader: shareLoader },
]
