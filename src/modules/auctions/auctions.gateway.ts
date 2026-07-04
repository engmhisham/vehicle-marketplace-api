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
  namespace: '/auctions',
  cors: { origin: '*' },
})
export class AuctionsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AuctionsGateway.name);

  constructor(private readonly redisService: RedisService) {
    this.setupRedisSubscriptions();
  }

  private setupRedisSubscriptions() {
    // Subscribe to bid events from all auction channels
    const subscriber = this.redisService.getSubscriber();
    subscriber.psubscribe('auction:*:bids');
    subscriber.psubscribe('auction:*:status');

    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const parts = channel.split(':');
      const auctionId = parts[1];
      const eventType = parts[2];

      if (eventType === 'bids') {
        this.server.to(`auction:${auctionId}`).emit('new-bid', JSON.parse(message));
      } else if (eventType === 'status') {
        this.server.to(`auction:${auctionId}`).emit('auction-status', JSON.parse(message));
      }
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-auction')
  handleJoinAuction(@ConnectedSocket() client: Socket, @MessageBody() data: { auctionId: string }) {
    client.join(`auction:${data.auctionId}`);
    this.logger.log(`Client ${client.id} joined auction ${data.auctionId}`);
    return { event: 'joined', data: { auctionId: data.auctionId } };
  }

  @SubscribeMessage('leave-auction')
  handleLeaveAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { auctionId: string },
  ) {
    client.leave(`auction:${data.auctionId}`);
    this.logger.log(`Client ${client.id} left auction ${data.auctionId}`);
    return { event: 'left', data: { auctionId: data.auctionId } };
  }
}
