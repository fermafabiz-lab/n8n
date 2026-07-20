import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Palette} from '../types';

/**
 * YouTube end screen: left half hosts the channel identity + animated
 * subscribe pill, the right half reserves a 16:9 zone where YouTube's own
 * clickable "next video" element gets overlaid in the Studio editor.
 */
export const OutroCard: React.FC<{
	channelName: string;
	subscribeText: string;
	palette: Palette;
	/** 9:16: stack identity above the next-video zone instead of side by side. */
	portrait?: boolean;
}> = ({channelName, subscribeText, palette, portrait = false}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {extrapolateRight: 'clamp'});
	const slideUp = interpolate(frame, [0, fps * 0.5], [24, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const buttonScale = spring({frame: frame - fps * 0.5, fps, config: {damping: 14, stiffness: 160}});
	const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2);

	return (
		<AbsoluteFill
			style={{
				background: `linear-gradient(135deg, ${palette.background} 0%, ${palette.secondary} 100%)`,
				opacity,
			}}
		>
			<div
				style={{
					display: 'flex',
					flexDirection: portrait ? 'column' : 'row',
					width: '100%',
					height: '100%',
					alignItems: 'center',
					justifyContent: 'center',
					padding: portrait ? '80px 44px' : '0 70px',
					gap: portrait ? 44 : 60,
					transform: `translateY(${slideUp}px)`,
				}}
			>
				{/* Channel identity + subscribe */}
				<div style={{flex: portrait ? 'none' : 1, textAlign: 'center'}}>
					<div
						style={{
							width: 120,
							height: 120,
							borderRadius: '50%',
							margin: '0 auto 26px',
							background: `linear-gradient(135deg, ${palette.primary}, #B8862E)`,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontFamily: 'Arial, sans-serif',
							fontWeight: 800,
							fontSize: 52,
							color: palette.secondary,
							boxShadow: `0 8px 40px ${palette.primary}55`,
						}}
					>
						{channelName.slice(0, 1).toUpperCase()}
					</div>
					<div
						style={{
							fontFamily: 'Georgia, serif',
							fontWeight: 700,
							fontSize: 38,
							color: palette.text,
							marginBottom: 26,
						}}
					>
						{channelName}
					</div>
					<div
						style={{
							transform: `scale(${Math.max(0, buttonScale) * pulse})`,
							display: 'inline-block',
							background: '#E62117',
							color: '#FFFFFF',
							fontFamily: 'Arial, sans-serif',
							fontWeight: 800,
							fontSize: 28,
							padding: '16px 44px',
							borderRadius: 999,
							boxShadow: '0 6px 30px rgba(230,33,23,0.45)',
						}}
					>
						{subscribeText}
					</div>
				</div>

				{/* Reserved zone for YouTube's clickable next-video element */}
				<div style={{flex: portrait ? 'none' : 1.15, width: portrait ? '84%' : undefined}}>
					<div
						style={{
							aspectRatio: '16/9',
							borderRadius: 14,
							border: `2px dashed ${palette.primary}66`,
							background: 'rgba(255,255,255,0.04)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexDirection: 'column',
							gap: 12,
						}}
					>
						<div
							style={{
								width: 0,
								height: 0,
								borderLeft: `26px solid ${palette.primary}`,
								borderTop: '16px solid transparent',
								borderBottom: '16px solid transparent',
								marginLeft: 6,
								opacity: 0.8,
							}}
						/>
						<div
							style={{
								fontFamily: 'Arial, sans-serif',
								fontSize: 19,
								letterSpacing: 3,
								color: `${palette.text}99`,
								textTransform: 'uppercase',
							}}
						>
							Next video
						</div>
					</div>
				</div>
			</div>
		</AbsoluteFill>
	);
};
