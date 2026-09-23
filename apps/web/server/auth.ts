import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError } from 'better-auth/api'
import { prisma } from './prisma'
import { env, adminEmails } from './env'

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  databaseHooks: {
    user: {
      create: {
        // Only allow-listed admins may ever hold an account; this is a staff console, not a signup.
        before: async (user) => {
          if (!adminEmails.includes(user.email.toLowerCase())) {
            throw new APIError('FORBIDDEN', { message: 'not an admin' })
          }
          return { data: user }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
