class UserService
  def destroy(user)
    DestroyUserWorker.perform_async(user.id)
  end
end
