# Video Tutorials

This directory contains video tutorials for the VaultDAO onboarding system.

## Required Videos

Place the following video files in this directory:

### Getting Started
- `getting-started.mp4` - Introduction to VaultDAO (5 min)
- `thumbnails/getting-started.jpg` - Thumbnail image

### Feature Tutorials
- `proposals-tutorial.mp4` - Creating and managing proposals (7 min)
- `templates-tutorial.mp4` - Using templates (4 min)
- `analytics-tutorial.mp4` - Understanding analytics (6 min)
- `recurring-payments.mp4` - Setting up recurring payments (5 min)

### Thumbnails
- `thumbnails/proposals.jpg`
- `thumbnails/templates.jpg`
- `thumbnails/analytics.jpg`
- `thumbnails/recurring.jpg`

## Video Specifications

### Format
- **Codec**: H.264 (MP4)
- **Resolution**: 1920x1080 (Full HD)
- **Frame Rate**: 30 fps
- **Bitrate**: 2-5 Mbps (adaptive)
- **Audio**: AAC, 128 kbps

### Mobile Optimization
- Provide multiple bitrate versions for adaptive streaming
- Use progressive download (not streaming)
- Optimize file size for mobile networks
- Test on 3G/4G connections

### Thumbnails
- **Format**: JPEG
- **Resolution**: 1280x720
- **Size**: < 100 KB

## Placeholder Videos

For development, you can use placeholder videos:

```bash
# Create a simple placeholder video (requires ffmpeg)
ffmpeg -f lavfi -i color=c=blue:s=1920x1080:d=5 \
  -f lavfi -i sine=f=1000:d=5 \
  -pix_fmt yuv420p -c:v libx264 -c:a aac \
  getting-started.mp4
```

## Video Hosting Alternatives

If you prefer not to host videos locally:

1. **YouTube**: Embed YouTube videos
2. **Vimeo**: Use Vimeo player
3. **AWS S3**: Host on S3 with CloudFront CDN
4. **Cloudinary**: Video hosting and optimization
5. **Bunny CDN**: Fast video delivery

Update video URLs in `src/constants/onboarding.ts` accordingly.

## Adding New Videos

1. Create video file (MP4 format)
2. Create thumbnail image (JPEG)
3. Add to this directory
4. Update `src/constants/onboarding.ts` with video metadata
5. Test video playback in browser

## Performance Tips

- Use video compression tools (HandBrake, FFmpeg)
- Enable browser caching headers
- Use CDN for faster delivery
- Implement lazy loading for video thumbnails
- Monitor video playback analytics
