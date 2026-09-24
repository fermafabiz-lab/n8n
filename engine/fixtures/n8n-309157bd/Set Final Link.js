const driveId = $('Upload Final To Drive').first().json.id;
return [{ json: {
  video_url: 'https://drive.google.com/uc?export=download&id=' + driveId,
  verify: $('Render Guard').last().json.verify || null,
} }];