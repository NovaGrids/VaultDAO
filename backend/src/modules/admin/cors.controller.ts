import { Controller, Get, Post, Delete, Put, Patch, Body, Param, Query, Req, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminGuard } from '../guards/admin.guard';
import { CorsService } from './cors.service';
import { CreateCorsOriginDto } from './dto/create-cors-origin.dto';
import { UpdateCorsOriginDto } from './dto/update-cors-origin.dto';

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS =
  'Content-Type, Authorization, X-API-Key, X-Request-ID, X-Signature, X-Timestamp';

@Controller('admin/cors')
@UseGuards(AdminGuard)
export class CorsController {
  constructor(private readonly corsService: CorsService) {}

  @Get('origins')
  async listOrigins(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.corsService.listOrigins({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post('origins')
  async createOrigin(@Body() dto: CreateCorsOriginDto) {
    return this.corsService.createOrigin(dto);
  }

  @Put('origins/:id')
  async updateOrigin(@Param('id') id: string, @Body() dto: UpdateCorsOriginDto) {
    return this.corsService.updateOrigin(id, dto);
  }

  @Patch('origins/:id')
  async patchOrigin(@Param('id') id: string, @Body() dto: UpdateCorsOriginDto) {
    return this.corsService.updateOrigin(id, dto);
  }

  @Delete('origins/:id')
  async deleteOrigin(@Param('id') id: string) {
    return this.corsService.deleteOrigin(id);
  }

  @Req()
  async handlePreflight(@Req() req: Request, @Res() res: Response) {
    const origin = req.headers.origin;
    if (origin && (await this.corsService.isOriginAllowed(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(HttpStatus.NO_CONTENT).send();
  }
}
