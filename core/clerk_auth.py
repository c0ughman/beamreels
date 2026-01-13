import os
import jwt
import requests
import logging
from functools import wraps
from django.http import JsonResponse

logger = logging.getLogger(__name__)

CLERK_JWKS_CACHE = {}
CLERK_JWKS_CACHE_TIME = 0

def get_clerk_jwks():
    global CLERK_JWKS_CACHE, CLERK_JWKS_CACHE_TIME
    import time

    current_time = time.time()
    if CLERK_JWKS_CACHE and (current_time - CLERK_JWKS_CACHE_TIME) < 3600:
        return CLERK_JWKS_CACHE

    clerk_publishable_key = os.environ.get('CLERK_PUBLISHABLE_KEY', '')
    if not clerk_publishable_key:
        logger.warning("CLERK_PUBLISHABLE_KEY not set")
        return None

    frontend_api = None
    if clerk_publishable_key.startswith('pk_test_'):
        frontend_api = clerk_publishable_key.replace('pk_test_', '').rstrip('$')
    elif clerk_publishable_key.startswith('pk_live_'):
        frontend_api = clerk_publishable_key.replace('pk_live_', '').rstrip('$')

    if not frontend_api:
        logger.error("Could not parse Clerk frontend API from publishable key")
        return None

    jwks_url = f"https://{frontend_api}.clerk.accounts.dev/.well-known/jwks.json"

    try:
        response = requests.get(jwks_url, timeout=10)
        response.raise_for_status()
        CLERK_JWKS_CACHE = response.json()
        CLERK_JWKS_CACHE_TIME = current_time
        return CLERK_JWKS_CACHE
    except Exception as e:
        logger.error(f"Failed to fetch Clerk JWKS: {e}")
        return None


def get_public_key_from_jwks(jwks, kid):
    for key in jwks.get('keys', []):
        if key.get('kid') == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(key)
    return None


def verify_clerk_token(token):
    if not token:
        return None

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get('kid')

        if not kid:
            logger.warning("No kid in JWT header")
            return None

        jwks = get_clerk_jwks()
        if not jwks:
            logger.warning("Could not get JWKS")
            return None

        public_key = get_public_key_from_jwks(jwks, kid)
        if not public_key:
            logger.warning(f"Could not find public key for kid: {kid}")
            return None

        decoded = jwt.decode(
            token,
            public_key,
            algorithms=['RS256'],
            options={
                'verify_aud': False,
                'verify_iss': False,
            }
        )

        return decoded

    except jwt.ExpiredSignatureError:
        logger.warning("JWT token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid JWT token: {e}")
        return None
    except Exception as e:
        logger.error(f"Error verifying JWT: {e}")
        return None


def get_user_id_from_request(request):
    auth_header = request.headers.get('Authorization', '')

    if not auth_header.startswith('Bearer '):
        return None

    token = auth_header[7:]
    decoded = verify_clerk_token(token)

    if decoded:
        return decoded.get('sub')

    return None


def clerk_auth_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user_id = get_user_id_from_request(request)

        if not user_id:
            return JsonResponse({'error': 'Authentication required'}, status=401)

        request.clerk_user_id = user_id
        return view_func(request, *args, **kwargs)

    return wrapper


def clerk_auth_optional(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user_id = get_user_id_from_request(request)
        request.clerk_user_id = user_id
        return view_func(request, *args, **kwargs)

    return wrapper
