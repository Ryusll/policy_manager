import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { getGoogleOAuthCallbackUrl } from '../common/config/public-url';

export interface GoogleOAuthProfile {
  email: string;
  name: string;
  googleId: string;
  picture?: string;
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

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string }[];
      displayName?: string;
      photos?: { value: string }[];
    },
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('No email from Google'), undefined);
      return;
    }
    const payload: GoogleOAuthProfile = {
      email,
      name: profile.displayName || email.split('@')[0] || 'User',
      googleId: profile.id,
      picture: profile.photos?.[0]?.value,
    };
    done(null, payload);
  }
}
