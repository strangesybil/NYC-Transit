from django.contrib import admin

from .models import Favorite, ServiceAlert

admin.site.register(ServiceAlert)
admin.site.register(Favorite)
