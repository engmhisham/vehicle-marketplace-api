import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private userSockets: Map<string, string[]> = new Map();

  constructor(private readonly redisService: RedisService) {
    this.setupRedisSubscriptions();
  }

  private setupRedisSubscriptions() {
    const subscriber = this.redisService.getSubscriber();
    subscriber.psubscribe('chat:*');

    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const parts = channel.split(':');
      const roomId = parts[1];

      if (parts[2] === 'read') {
        this.server.to(`room:${roomId}`).emit('read-receipt', JSON.parse(message));
      } else {
        this.server.to(`room:${roomId}`).emit('new-message', JSON.parse(message));
      }
    });
  }

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      const sockets = this.userSockets.get(userId) || [];
      sockets.push(client.id);
      this.userSockets.set(userId, sockets);
    }
    this.logger.log(`Chat client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Clean up from all user entries (handles missing userId case)
    for (const [userId, sockets] of this.userSockets.entries()) {
      const filtered = sockets.filter((id) => id !== client.id);
      if (filtered.length === 0) {
        this.userSockets.delete(userId);
      } else if (filtered.length !== sockets.length) {
        this.userSockets.set(userId, filtered);
      }
    }
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    client.join(`room:${data.roomId}`);
    return { event: 'joined-room', data: { roomId: data.roomId } };
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    client.leave(`room:${data.roomId}`);
    return { event: 'left-room', data: { roomId: data.roomId } };
  }

  @SubscribeMessage('typing')
  handleTyping(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const userId = client.handshake.query.userId as string;
    client.to(`room:${data.roomId}`).emit('user-typing', { userId, roomId: data.roomId });
  }

  @SubscribeMessage('stop-typing')
  handleStopTyping(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const userId = client.handshake.query.userId as string;
    client.to(`room:${data.roomId}`).emit('user-stop-typing', { userId, roomId: data.roomId });
  }
}
