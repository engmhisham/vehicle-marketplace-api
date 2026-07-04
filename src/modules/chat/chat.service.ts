import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async sendMessage(senderId: string, dto: SendMessageDto) {
    // Find or create chat room
    const room = await this.findOrCreateRoom(senderId, dto.recipientId, dto.vehicleId);

    const message = await this.prisma.chatMessage.create({
      data: {
        roomId: room.id,
        senderId,
        content: dto.content,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update last message timestamp
    await this.prisma.chatRoom.update({
      where: { id: room.id },
      data: { lastMessageAt: new Date() },
    });

    // Increment unread counter and publish for real-time delivery (non-blocking)
    try {
      await this.redisService.hincrby(`unread:${dto.recipientId}`, room.id, 1);
      await this.redisService.publish(
        `chat:${room.id}`,
        JSON.stringify({
          id: message.id,
          roomId: room.id,
          senderId,
          senderName: `${message.sender.firstName || ''} ${message.sender.lastName || ''}`.trim(),
          content: dto.content,
          createdAt: message.createdAt.toISOString(),
        }),
      );
    } catch (error) {
      // Log but don't fail - message is already persisted in DB
      const logger = new Logger('ChatService');
      logger.error(`Failed to publish chat event for room ${room.id}`, error);
    }

    return message;
  }

  async getRooms(userId: string) {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        OR: [{ participant1Id: userId }, { participant2Id: userId }],
      },
      include: {
        participant1: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        participant2: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    // Get all unread counts in a single Redis call (avoids N+1)
    const unreadMap = await this.redisService.getClient().hgetall(`unread:${userId}`);

    const roomsWithUnread = rooms.map((room) => ({
      ...room,
      unreadCount: parseInt(unreadMap[room.id] || '0', 10),
    }));

    return roomsWithUnread;
  }

  async getMessages(roomId: string, userId: string, pagination: PaginationDto) {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });

    if (!room) {
      throw new NotFoundException('Chat room not found');
    }

    if (room.participant1Id !== userId && room.participant2Id !== userId) {
      throw new ForbiddenException('You are not a participant of this chat');
    }

    const [messages, total] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { roomId },
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.chatMessage.count({ where: { roomId } }),
    ]);

    return paginate(messages, total, pagination.page, pagination.limit);
  }

  async markAsRead(roomId: string, userId: string) {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });

    if (!room) {
      throw new NotFoundException('Chat room not found');
    }

    if (room.participant1Id !== userId && room.participant2Id !== userId) {
      throw new ForbiddenException('You are not a participant of this chat');
    }

    // Mark all unread messages as read
    await this.prisma.chatMessage.updateMany({
      where: {
        roomId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    // Clear unread counter in Redis
    await this.redisService.hdel(`unread:${userId}`, roomId);

    // Publish read receipt
    const otherUserId = room.participant1Id === userId ? room.participant2Id : room.participant1Id;
    await this.redisService.publish(
      `chat:${roomId}:read`,
      JSON.stringify({ userId, roomId, readAt: new Date().toISOString() }),
    );

    return { message: 'Messages marked as read' };
  }

  async getUnreadCount(userId: string): Promise<number> {
    const unreadMap = await this.redisService.getClient().hgetall(`unread:${userId}`);
    return Object.values(unreadMap).reduce((sum, count) => sum + parseInt(count, 10), 0);
  }

  private async findOrCreateRoom(userId1: string, userId2: string, vehicleId?: string) {
    // Ensure consistent ordering
    const [p1, p2] = [userId1, userId2].sort();

    const existing = await this.prisma.chatRoom.findFirst({
      where: {
        participant1Id: p1,
        participant2Id: p2,
        vehicleId: vehicleId || null,
      },
    });

    if (existing) return existing;

    return this.prisma.chatRoom.create({
      data: {
        participant1Id: p1,
        participant2Id: p2,
        vehicleId,
      },
    });
  }
}
