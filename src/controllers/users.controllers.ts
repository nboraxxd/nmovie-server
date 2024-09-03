import ms from 'ms'
import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'

import usersService from '@/services/users.services'
import { HttpStatusCode } from '@/constants/http-status-code'
import envVariables from '@/schemas/env-variables.schema'
import { MessageResponseType } from '@/schemas/common.schema'
import { RegisterBodyType, AuthResponseType, EmailVerifyTokenType, LoginBodyType } from '@/schemas/user.schema'
import { TokenPayload } from '@/types/token.type'
import { EntityError, ErrorWithStatus } from '@/models/errors'
import { verifyToken } from '@/utils/jwt'
import { calculateRemainingTimeInSeconds } from '@/utils/common'
import { hashPassword } from '@/utils/crypto'
import z from 'zod'

export const registerController = async (
  req: Request<ParamsDictionary, any, RegisterBodyType>,
  res: Response<AuthResponseType>
) => {
  const { email, name, password } = req.body

  const result = await usersService.register({ email, name, password })

  return res
    .status(HttpStatusCode.Created)
    .json({ message: 'Please check your email to verify your account.', data: result })
}

export const resendEmailVerificationController = async (req: Request, res: Response<MessageResponseType>) => {
  const { isVerified, userId } = req.decodedAuthorization as TokenPayload

  if (isVerified === true) {
    throw new ErrorWithStatus({
      message: 'Account has been verified',
      statusCode: 400,
    })
  }

  const user = await usersService.findById(userId)

  if (!user) {
    throw new ErrorWithStatus({
      message: 'User not found',
      statusCode: 404,
    })
  }

  const decodedEmailVerifyToken = await verifyToken({
    token: user.email_verify_token as string,
    secretOrPublicKey: envVariables.JWT_SECRET_EMAIL_VERIFY_TOKEN,
  })

  const nextEmailResendTime = new Date(decodedEmailVerifyToken.iat * 1000 + ms(envVariables.RESEND_EMAIL_DEBOUNCE_TIME))

  const remainingTimeInSeconds = calculateRemainingTimeInSeconds(nextEmailResendTime)

  if (remainingTimeInSeconds > 0) {
    throw new ErrorWithStatus({
      message: `Please try again in ${remainingTimeInSeconds} seconds`,
      statusCode: 429,
    })
  }

  await usersService.resendEmailVerification({ email: user.email, name: user.name, userId: user._id })

  return res.json({ message: 'Please check your email to verify your account.' })
}

export const verifyEmailController = async (
  req: Request<ParamsDictionary, any, EmailVerifyTokenType>,
  res: Response<AuthResponseType>
) => {
  const { emailVerifyToken } = req.body

  const decodedEmailVerifyToken = await verifyToken({
    token: emailVerifyToken,
    secretOrPublicKey: envVariables.JWT_SECRET_EMAIL_VERIFY_TOKEN,
  })

  const { userId } = decodedEmailVerifyToken

  const user = await usersService.findById(userId)

  if (!user) {
    throw new ErrorWithStatus({
      message: 'User not found',
      statusCode: 404,
    })
  }

  if (user.email_verify_token === null) {
    throw new ErrorWithStatus({
      message: 'Email already verified',
      statusCode: 400,
    })
  }

  const result = await usersService.verifyEmail(userId)

  return res.json({ message: 'Email verified successfully', data: result })
}

export const loginController = async (
  req: Request<ParamsDictionary, any, LoginBodyType>,
  res: Response<AuthResponseType>
) => {
  const { email, password } = req.body

  const user = await usersService.findByEmail(email)

  if (!user || user.password !== hashPassword(password)) {
    throw new EntityError({
      errors: [
        {
          code: z.ZodIssueCode.custom,
          message: 'Invalid email or password',
          path: 'email',
          location: 'body',
        },
      ],
    })
  }

  const result = await usersService.login({
    userId: user._id.toHexString(),
    isVerified: user.email_verify_token === null,
  })

  return res.json({ message: 'Login successful', data: result })
}
