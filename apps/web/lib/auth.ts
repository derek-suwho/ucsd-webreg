import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { loadWebEnv } from '@webreg/config'
import { prisma } from '@webreg/db'

const env = loadWebEnv()
if (env.APP_ORIGIN) process.env.AUTH_URL = env.APP_ORIGIN

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile }) {
      const email = profile?.email?.trim()
      if (profile?.email_verified === true && email) {
        const user = await prisma.user.upsert({
          where: { email },
          create: { email, name: profile.name ?? null },
          update: { name: profile.name ?? null },
        })
        token.uid = user.id
      }
      return token
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string
      return session
    },
  },
})
