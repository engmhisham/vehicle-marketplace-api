import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Chat')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('messages')
  @ApiOperation({ summary: 'Send a message' })
  @ApiResponse({ status: 201, description: 'Message sent' })
  async sendMessage(@CurrentUser() user: JwtPayload, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(user.sub, dto);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Get chat rooms' })
  @ApiResponse({ status: 200, description: 'Chat rooms list' })
  async getRooms(@CurrentUser() user: JwtPayload) {
    return this.chatService.getRooms(user.sub);
  }

  @Get('rooms/:roomId/messages')
  @ApiOperation({ summary: 'Get messages in a chat room' })
  @ApiResponse({ status: 200, description: 'Messages list' })
  async getMessages(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Query() pagination: PaginationDto,
  ) {
    return this.chatService.getMessages(roomId, user.sub, pagination);
  }

  @Patch('rooms/:roomId/read')
  @ApiOperation({ summary: 'Mark messages as read' })
  @ApiResponse({ status: 200, description: 'Messages marked as read' })
  async markAsRead(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.chatService.markAsRead(roomId, user.sub);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get total unread message count' })
  @ApiResponse({ status: 200, description: 'Unread count' })
  async getUnreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.chatService.getUnreadCount(user.sub);
    return { unreadCount: count };
  }
}
