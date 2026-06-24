from celery import shared_task

@shared_task
def send_welcome_email(user_id):
    return f"sent to {user_id}"
