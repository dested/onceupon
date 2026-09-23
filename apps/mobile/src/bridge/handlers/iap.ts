import {
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Product,
  type ProductOrSubscription,
  type Purchase,
} from 'expo-iap'
import { z } from 'zod'
import { BridgeHostError, parseInput, type Handler } from '../host'

// StoreKit 2 through expo-iap. In this version the signed transaction (JWS the server verifies) is
// the unified `purchaseToken` field on an iOS purchase. A purchase is initiated with requestPurchase
// and resolved from the purchaseUpdatedListener, so a single set of listeners is installed lazily.

interface PendingPurchase {
  resolve: (purchase: Purchase) => void
  reject: (error: BridgeHostError) => void
}

function isCancelled(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if (!('code' in err)) return false
  return err.code === ErrorCode.UserCancelled
}

// Structural shape covering both PurchaseError variants expo-iap ships (types vs errorMapping),
// whose `code` optionality differs. We only read code + message.
function mapPurchaseError(error: { code?: unknown; message: string }): BridgeHostError {
  if (error.code === ErrorCode.UserCancelled) return new BridgeHostError('cancelled', error.message)
  return new BridgeHostError('failed', error.message)
}

function mapUnknownError(err: unknown): BridgeHostError {
  if (err instanceof BridgeHostError) return err
  if (isCancelled(err)) return new BridgeHostError('cancelled', 'purchase cancelled')
  if (err instanceof Error) return new BridgeHostError('failed', err.message)
  return new BridgeHostError('failed', 'purchase failed')
}

function isInAppProduct(p: ProductOrSubscription): p is Product {
  return p.type === 'in-app'
}

class Iap {
  private connected: Promise<void> | null = null
  private listenersReady = false
  private readonly pending = new Map<string, PendingPurchase>()
  private readonly finishable = new Map<string, Purchase>()

  private connect(): Promise<void> {
    if (!this.connected) this.connected = initConnection().then(() => undefined)
    return this.connected
  }

  private ensureListeners(): void {
    if (this.listenersReady) return
    this.listenersReady = true
    purchaseUpdatedListener((purchase) => {
      const waiter = this.pending.get(purchase.productId)
      if (!waiter) return
      this.pending.delete(purchase.productId)
      const transactionId = purchase.transactionId
      if (typeof transactionId === 'string' && transactionId.length > 0) {
        this.finishable.set(transactionId, purchase)
      }
      waiter.resolve(purchase)
    })
    purchaseErrorListener((error) => {
      const targets = error.productId ? [error.productId] : [...this.pending.keys()]
      for (const productId of targets) {
        const waiter = this.pending.get(productId)
        if (!waiter) continue
        this.pending.delete(productId)
        waiter.reject(mapPurchaseError(error))
      }
    })
  }

  private readonly productsSchema = z.object({ productIds: z.array(z.string()) })
  products: Handler<'iap.products'> = async (input) => {
    const { productIds } = parseInput(this.productsSchema, input)
    await this.connect()
    const fetched = await fetchProducts({ skus: productIds, type: 'in-app' })
    const list: ProductOrSubscription[] = Array.isArray(fetched) ? fetched : []
    const products = list.filter(isInAppProduct).map((p) => ({
      productId: p.id,
      localizedPrice: p.displayPrice,
      currency: p.currency,
    }))
    return { products }
  }

  private readonly purchaseSchema = z.object({ productId: z.string() })
  purchase: Handler<'iap.purchase'> = async (input) => {
    const { productId } = parseInput(this.purchaseSchema, input)
    await this.connect()
    this.ensureListeners()

    const purchase = await new Promise<Purchase>((resolve, reject) => {
      if (this.pending.has(productId)) {
        reject(new BridgeHostError('failed', `a purchase for ${productId} is already in progress`))
        return
      }
      this.pending.set(productId, { resolve, reject })
      requestPurchase({ request: { apple: { sku: productId } }, type: 'in-app' }).catch((err: unknown) => {
        const waiter = this.pending.get(productId)
        if (!waiter) return
        this.pending.delete(productId)
        waiter.reject(mapUnknownError(err))
      })
    })

    const jws = purchase.purchaseToken
    const transactionId = purchase.transactionId
    if (typeof jws !== 'string' || jws.length === 0) {
      throw new BridgeHostError('failed', 'purchase is missing its signed transaction')
    }
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new BridgeHostError('failed', 'purchase is missing its transaction id')
    }
    this.finishable.set(transactionId, purchase)
    return { jws, transactionId }
  }

  restore: Handler<'iap.restore'> = async () => {
    await this.connect()
    const purchases = await getAvailablePurchases()
    const jws: string[] = []
    for (const purchase of purchases) {
      const transactionId = purchase.transactionId
      if (typeof transactionId === 'string' && transactionId.length > 0) {
        this.finishable.set(transactionId, purchase)
      }
      if (typeof purchase.purchaseToken === 'string' && purchase.purchaseToken.length > 0) {
        jws.push(purchase.purchaseToken)
      }
    }
    return { jws }
  }

  private readonly finishSchema = z.object({ transactionId: z.string() })
  finish: Handler<'iap.finish'> = async (input) => {
    const { transactionId } = parseInput(this.finishSchema, input)
    const purchase = this.finishable.get(transactionId)
    if (!purchase) throw new BridgeHostError('bad_request', `unknown transaction: ${transactionId}`)
    await finishTransaction({ purchase, isConsumable: true })
    this.finishable.delete(transactionId)
    return {}
  }
}

const iap = new Iap()

export const iapProducts = iap.products
export const iapPurchase = iap.purchase
export const iapRestore = iap.restore
export const iapFinish = iap.finish
