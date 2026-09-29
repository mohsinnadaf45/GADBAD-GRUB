import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import raceApi from '../services/raceApi';
import predictionApi from '../services/predictionApi';
import useRaceSocket from './useRaceSocket';
import useAuth from './useAuth';
import { DEMO_RACERS } from '../utils/constants';
import { normalizeRace } from '../utils/normalizeRace';

export function useRace(raceId) {
  const { addPoints, unlockBadge } = useAuth();

  const [resolvedRaceId, setResolvedRaceId] = useState(raceId || null);
  const [race, setRace] = useState(null);
  const [events, setEvents] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userPrediction, setUserPrediction] = useState(null);
  const [nitroActive, setNitroActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [winner, setWinner] = useState(null);

  // Fallback simulator interval ref
  const simTimerRef = useRef(null);
  const finishingRef = useRef(false);

  // Finish handling
  const handleRaceFinish = useCallback((winningRacer) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setIsFinished(true);
    setWinner(winningRacer);

    speechSynthesis.speak(new SpeechSynthesisUtterance('Congratulations, you just lost 20 seconds of your life.'));

    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#00F0FF', '#FFB800', '#FF3366', '#00E676'],
      });
    } catch {
      // Ignore if confetti context not ready
    }

    addPoints(150, 'Race Completed Delivery');
    unlockBadge('FIRST_ORDER');

    if (userPrediction && winningRacer && userPrediction.predictedRacerId === winningRacer.id) {
      addPoints(300, 'Correct Prediction Winner!');
      unlockBadge('PREDICTION_KING');
    }
  }, [userPrediction, addPoints, unlockBadge]);

  // Resolve race id (create live race when /race opened with no/invalid id)
  useEffect(() => {
    let mounted = true;

    async function resolveAndLoad() {
      setLoading(true);
      setError(null);
      finishingRef.current = false;

      try {
        let id = raceId;
        let raceData = null;

        if (!id || id === 'race_live_demo_01' || id === 'race_01' || id === 'race_02') {
          // Placeholder / hub entry — spin up or attach to a real live race
          raceData = await raceApi.ensureLiveRace();
          id = raceData._id;
        } else {
          try {
            raceData = await raceApi.getRace(id);
          } catch {
            raceData = await raceApi.ensureLiveRace();
            id = raceData._id;
          }
        }

        if (!mounted) return;

        // If backend race is waiting, kick the simulator
        if (raceData.status === 'waiting') {
          try {
            await raceApi.startRace(id);
            raceData = normalizeRace({ ...raceData, status: 'racing' });
          } catch {
            // local sim will take over if SSE/start fails
          }
        }

        setResolvedRaceId(id);

        const [eventData, predData] = await Promise.all([
          raceApi.getRaceEvents(id).catch(() => []),
          predictionApi.getPrediction(id).catch(() => null),
        ]);

        if (!mounted) return;

        const racers =
          raceData.racers?.length > 0
            ? raceData.racers
            : DEMO_RACERS.map((r, idx) => ({
                ...r,
                progress: Math.max(5, 55 - idx * 8),
                speed: r.baseSpeed,
                rank: idx + 1,
                distanceLeftKm: (3.0 - idx * 0.4).toFixed(1),
              }));

        const hydrated = normalizeRace({ ...raceData, racers });
        setRace(hydrated);
        setEvents(eventData || []);
        setUserPrediction(predData);
        setLeaderboard([...hydrated.racers].sort((a, b) => b.progress - a.progress));

        if (hydrated.status === 'finished' || hydrated.progress >= 100) {
          setIsFinished(true);
          setWinner(hydrated.racers[0]);
          speechSynthesis.speak(new SpeechSynthesisUtterance('Congratulations, you just lost 20 seconds of your life.'));
        } else {
          setIsFinished(false);
          setWinner(null);
        }
      } catch (err) {
        if (mounted) setError(err.message || 'Failed to load live race');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    resolveAndLoad();
    return () => {
      mounted = false;
    };
  }, [raceId]);

  // Handle Socket Events
  const handleStateUpdate = useCallback((state) => {
    setRace((prev) => {
      const merged = normalizeRace({ ...prev, ...state });
      return merged;
    });
    if (state.racers) {
      setLeaderboard([...state.racers].sort((a, b) => b.progress - a.progress));
    }
    if (state.status === 'finished' || state.progress >= 100) {
      handleRaceFinish(state.winner || (state.racers && state.racers[0]));
    }
  }, [handleRaceFinish]);

  const handleEventUpdate = useCallback((event) => {
    setEvents((prev) => [event, ...prev].slice(0, 40));
  }, []);

  const handleLeaderboardUpdate = useCallback((ranks) => {
    setLeaderboard(ranks);
  }, []);

  const handleFinishedUpdate = useCallback((result) => {
    handleRaceFinish(result.winner);
  }, [handleRaceFinish]);

  const { connected } = useRaceSocket(resolvedRaceId, {
    onState: handleStateUpdate,
    onEvent: handleEventUpdate,
    onLeaderboard: handleLeaderboardUpdate,
    onFinished: handleFinishedUpdate,
  });

  // Client Simulation fallback when socket is disconnected
  useEffect(() => {
    if (!resolvedRaceId || isFinished || connected) {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      return;
    }

    simTimerRef.current = setInterval(() => {
      setRace((prev) => {
        if (!prev || prev.status === 'finished' || prev.progress >= 100) {
          if (simTimerRef.current) clearInterval(simTimerRef.current);
          return prev;
        }

        const updatedRacers = (prev.racers || DEMO_RACERS).map((racer) => {
          const delta = Math.random() * 2.8 + 1.2;
          const newProgress = Math.min(100, Math.round((racer.progress + delta) * 10) / 10);
          const currentSpeed = Math.round((racer.baseSpeed || 55) + (Math.random() * 8 - 4));
          const distanceLeft = Math.max(0, ((100 - newProgress) * 0.035).toFixed(2));
          return {
            ...racer,
            progress: newProgress,
            speed: currentSpeed,
            distanceLeftKm: distanceLeft,
          };
        });

        updatedRacers.sort((a, b) => b.progress - a.progress);
        const rankedRacers = updatedRacers.map((r, idx) => ({ ...r, rank: idx + 1 }));

        const primaryRacer = rankedRacers.find((r) => r.id === prev.racerId) || rankedRacers[0];
        const newOverallProgress = primaryRacer.progress;
        const newEtaSeconds = Math.max(0, Math.round((100 - newOverallProgress) * 4.2));

        if (rankedRacers.some((r) => r.progress >= 100)) {
          clearInterval(simTimerRef.current);
          const champ = rankedRacers[0];
          setTimeout(() => handleRaceFinish(champ), 100);

          return {
            ...prev,
            progress: 100,
            etaSeconds: 0,
            status: 'finished',
            racers: rankedRacers,
          };
        }

        if (Math.random() > 0.6) {
          const sampleCommentary = [
            `⚡ ${rankedRacers[0].name} leans into the hairpin turn with max tire traction!`,
            `💨 Slipstream alert! ${rankedRacers[1]?.name || 'Challenger'} is drafting right behind the leader!`,
            `🚦 Green light sequence! Virtual traffic cleared on Grand Boulevard.`,
            `🔥 Engine RPM spiking! ${rankedRacers[0].name} hits 68 km/h on the straightaway!`,
            `🍔 Food container thermal sensors reading 65°C - piping hot and secure!`,
          ];
          const randomMsg = sampleCommentary[Math.floor(Math.random() * sampleCommentary.length)];
          setEvents((ePrev) => [
            {
              _id: `evt_sim_${Date.now()}`,
              raceId: prev._id,
              type: 'SIM_UPDATE',
              message: randomMsg,
              source: 'simulator',
              createdAt: new Date().toISOString(),
            },
            ...ePrev.slice(0, 15),
          ]);
        }

        setLeaderboard(rankedRacers);

        return {
          ...prev,
          progress: newOverallProgress,
          etaSeconds: newEtaSeconds,
          status: 'racing',
          racers: rankedRacers,
        };
      });
    }, 1800);

    return () => {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, [resolvedRaceId, isFinished, connected, handleRaceFinish]);

  // Submit Winner Prediction
  const submitPrediction = async (racerId) => {
    try {
      const pred = await predictionApi.submitPrediction(resolvedRaceId, {
        userId: 'user_demo_1',
        predictedRacerId: racerId,
      });
      setUserPrediction(pred);
      addPoints(50, 'Prediction Submitted');
      return pred;
    } catch (err) {
      console.error('Failed to submit prediction', err);
    }
  };

  // Interactive Nitro Boost trigger
  const triggerNitroBoost = () => {
    if (nitroActive || isFinished) return;
    setNitroActive(true);

    setRace((prev) => {
      if (!prev) return prev;
      const boosted = (prev.racers || []).map((r) => {
        if (r.id === prev.racerId || r.rank === 1) {
          return { ...r, progress: Math.min(99, r.progress + 4), speed: (r.speed || 55) + 15 };
        }
        return r;
      });
      return { ...prev, racers: boosted };
    });

    setEvents((prev) => [
      {
        _id: `nitro_${Date.now()}`,
        raceId: resolvedRaceId,
        type: 'NITRO_BURST',
        message: '🚀 NITRO SUPERCHARGER ENGAGED! Spectator cheer triggered +15 km/h surge!',
        source: 'simulator',
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);

    setTimeout(() => {
      setNitroActive(false);
    }, 3000);
  };

  return {
    race,
    events,
    leaderboard,
    loading,
    error,
    userPrediction,
    submitPrediction,
    nitroActive,
    triggerNitroBoost,
    isFinished,
    winner,
    connected,
    raceId: resolvedRaceId,
  };
}

export default useRace;
