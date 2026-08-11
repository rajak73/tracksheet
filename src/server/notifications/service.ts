import { prisma } from "@/server/db";

export async function createNotification(userId: string, title: string, message: string) {
  return prisma.notification.create({
    data: {
      userId,
      title,
      message,
    }
  });
}
