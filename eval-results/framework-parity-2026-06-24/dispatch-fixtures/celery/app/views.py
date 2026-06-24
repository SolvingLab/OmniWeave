from .tasks import send_welcome_email

def signup(request):
    user_id = create_user(request)
    send_welcome_email.delay(user_id)
    return user_id
