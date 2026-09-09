import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { getGoogleOAuthCallbackUrl } from '../common/config/public-url';

export interface GoogleOAuthProfile {
  email: string;
  name: string;
  googleId: string;
  picture?: string;
  /**
   * 구글이 이 주소의 소유를 확인했는가(`email_verified`).
   * 확인되지 않은 주소를 그대로 믿으면 남의 이메일을 주장해 기존 계정에
   * 연결될 수 있다 — 판단은 `resolveGoogleAccount` 가 한다(T-42).
   */
  emailVerified: boolean;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'unset',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'unset',
      callbackURL: getGoogleOAuthCallbackUrl(),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string; verified?: boolean }[];
      displayName?: string;
      photos?: { value: string }[];
      _json?: { email_verified?: boolean };
    },
    done: VerifyCallback,
  ): void {
    // 사용자 조회는 소문자 이메일로 한다. 여기서 낮추지 않으면 구글이 표기를
    // 다르게 주는 순간 "그 조직에 없는 계정"이 된다(T-42).
    const email = profile.emails?.[0]?.value?.trim().toLowerCase();
    if (!email) {
      done(new Error('No email from Google'), undefined);
      return;
    }
    // passport-google-oauth20 은 openid 프로필에서 `email_verified` 를
    // `emails[0].verified` 로 옮겨 준다. 둘 다 보고 하나라도 참이면 확인된 것으로 본다.
    const emailVerified =
      profile.emails?.[0]?.verified === true || profile._json?.email_verified === true;
    const payload: GoogleOAuthProfile = {
      email,
      name: profile.displayName || email.split('@')[0] || 'User',
      googleId: profile.id,
      picture: profile.photos?.[0]?.value,
      emailVerified,
    };
    done(null, payload);
  }
}
